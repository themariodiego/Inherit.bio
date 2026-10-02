-- Another adult's genome under the register's Path B
-- (20260928150000_other_adult_held_upload.sql; G2.6 adult half, G5.3).
--
-- Proves, on synthetic rows only, that:
--   * consent.upload-other-adult v1 is kept, superseded by the approved v2
--     that Path B signs, and the person's approved e-signature artifact is
--     seeded under its own key;
--   * a Path B draft checks 18 or older on the server, keeps its flow
--     immutable, and is the only kind of reservation the uploader can sign
--     for, request a signature for, or upload to;
--   * a Path A invitation never receives an inviter upload, and Path A's own
--     account acceptance still works and cannot confirm a Path B request;
--   * the person signs without an account, and only then can the uploader
--     upload; every file revision is held with no genome_files row, and the
--     same commit queues the upload-time notice and its credential;
--   * a held source is unreadable by every reader function, before and after
--     the person confirms that revision (confirmation commits the register's
--     confirmed_blocked_current_gate outcome with zero job);
--   * refusal of one revision, the person's delete, expiry and the uploader's
--     account deletion reject the held session, and the existing
--     upload-working executor purges its objects and rows.
-- Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc

-- claim_mail_outbox hands out the oldest deliverable row; retire any queued
-- mail on a shared developer database so every claim below is this suite's.
update public.mail_outbox set state='invalidated' where state in ('queued','claimed');

insert into private.upload_authorization_config(singleton,auth_issuer)
 values(true,'http://127.0.0.1:54321/auth/v1')
 on conflict(singleton) do update set auth_issuer=excluded.auth_issuer;
update private.upload_authorization_config set maximum_array_bytes=52428800,maximum_vcf_bytes=52428800,
 maximum_account_bytes=1073741824,maximum_active_uploads=32 where singleton;

insert into auth.users(id,email,raw_user_meta_data) values
 ('0a5e0000-0000-4000-8000-000000000001','held-uploader@e2e.local','{"display_name":"Synthetic uploader"}'),
 ('0a5e0000-0000-4000-8000-000000000002','held-invitee@e2e.local','{"display_name":"Synthetic invitee"}'),
 ('0a5e0000-0000-4000-8000-000000000009','held-outsider@e2e.local','{"display_name":"Synthetic outsider"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('0a5e0000-0000-4000-8000-000000000011','0a5e0000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('0a5e0000-0000-4000-8000-000000000012','0a5e0000-0000-4000-8000-000000000002',now(),now(),'aal1'),
 ('0a5e0000-0000-4000-8000-000000000019','0a5e0000-0000-4000-8000-000000000009',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id in
 ('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000002','0a5e0000-0000-4000-8000-000000000009');
-- The uploader has also stored their own DNA, so their own readers are live:
-- a held file must not appear through them either.
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['1','2']) letter;
select public.sign_own_upload_artifact_v1('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',
 (select id from public.subjects where subject_account_id='0a5e0000-0000-4000-8000-000000000001' and subject_class='self'),
 'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('1',64));
select public.sign_own_upload_artifact_v1('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',
 (select id from public.subjects where subject_account_id='0a5e0000-0000-4000-8000-000000000001' and subject_class='self'),
 'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('2',64));

-- 1. The artifacts -------------------------------------------------------------
-- The owner's decisions of 2026-09-28: consent.upload-other-adult v1 is kept as
-- the earlier approved version and superseded by v2, which Path B signs; the
-- person's consent.subject-adult-esignature v1 is approved and seeded. Every
-- row's body hashes to its recorded hash (the files are held equal to these
-- rows by content/legal/consent-upload-other-adult.test.ts).
select ok((select count(*)=2 and bool_and(effective_on=date '2026-09-28'
  and body_sha256=encode(extensions.digest(convert_to(body_markdown,'UTF8'),'sha256'),'hex'))
 from public.consent_artifacts where artifact_key='consent.upload-other-adult'),
 'consent.upload-other-adult has two approved, hash-verified versions');
select ok((select superseded_at is not null and summary_of_changes is null
 from public.consent_artifacts where artifact_key='consent.upload-other-adult' and version=1),
 'v1 is kept, superseded, not deleted');
select ok((select superseded_at is null and nullif(btrim(summary_of_changes),'') is not null
  and body_markdown like '%6. I understand that nothing is analysed until they say yes to the file,%'
 from public.consent_artifacts where artifact_key='consent.upload-other-adult' and version=2),
 'v2 is current, says what changed, and its statement 6 reads "until they say yes to the file"');
select is((select version from private.current_hashed_artifact_v1('consent.upload-other-adult')),2,
 'the uploader''s current artifact is v2');
select ok((select count(*)=1 and bool_and(version=1 and superseded_at is null and effective_on=date '2026-09-28'
  and body_sha256=encode(extensions.digest(convert_to(body_markdown,'UTF8'),'sha256'),'hex'))
 from public.consent_artifacts where artifact_key='consent.subject-adult-esignature'),
 'the person''s consent.subject-adult-esignature v1 is seeded, approved and hash-verified');
select ok((select count(*)=1 and bool_and(superseded_at is null) from public.consent_artifacts
 where artifact_key='consent.subject-adult'),'it keeps its own key: Path A''s consent.subject-adult is untouched');
select is((select count(*) from pg_proc where proname='install_test_local_subject_esignature_artifact_v1'),0::bigint,
 'no TEST-LOCAL installer exists any more');

-- 2. Helpers ---------------------------------------------------------------------
create temporary table fx(name text primary key, subject_id uuid, token_hash text, session_hash text);
grant all on fx to service_role;
create function pg_temp.sid(p_name text) returns uuid language sql as $$ select subject_id from fx where name=p_name $$;
create function pg_temp.draft(p_name text,p_request text,p_dob date default date '1980-05-05',
 p_flag boolean default true,p_label text default 'Synthetic Relative') returns jsonb language plpgsql as $$
declare r jsonb;
begin
 r:=public.create_path_b_adult_draft_v1('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',
  p_label,p_dob,decode('00112233445566778899aabbccddeeff','hex'),repeat(p_request,64),repeat(p_request,64),p_flag);
 insert into fx(name,subject_id) values(p_name,(r->>'subjectDraftId')::uuid) on conflict(name) do nothing;
 return r;
end;
$$;
create function pg_temp.present(p_subject uuid,p_nonce text,p_flag boolean default true,
 p_account uuid default '0a5e0000-0000-4000-8000-000000000001',p_session uuid default '0a5e0000-0000-4000-8000-000000000011')
returns jsonb language sql as $$
 select public.present_other_adult_upload_artifact_v1(p_account,p_session,p_subject,repeat(p_nonce,64),
  clock_timestamp()+interval '9 minutes',p_flag);
$$;
create function pg_temp.sign(p_subject uuid,p_nonce text,p_keys text[] default array['subject-alive-and-adult',
 'subject-permission-held','lawfully-held-with-knowledge','contact-belongs-to-subject','no-excluded-relationship',
 'held-until-accepted','no-uploader-access'],p_flag boolean default true,p_version integer default 2)
returns jsonb language sql as $$
 select public.sign_other_adult_upload_artifact_v1('0a5e0000-0000-4000-8000-000000000001',
  '0a5e0000-0000-4000-8000-000000000011',p_subject,p_version,
  (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-other-adult' and version=p_version),
  p_keys,decode(repeat('ab',24),'hex'),repeat(p_nonce,64),p_flag);
$$;
create function pg_temp.invite(p_subject uuid,p_hmac text,p_idem text,p_flag boolean default true) returns jsonb language sql as $$
 select public.create_path_b_invitation_v1('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',
  p_subject,p_hmac,p_idem,p_flag,p_quota_keys=>pg_temp.invitation_quota_keys());
$$;
-- Claim mail until the row for this target is claimed; returns its raw token's hash.
create function pg_temp.claim_for(p_target uuid) returns text language plpgsql as $$
declare d record; i integer;
begin
 for i in 1..50 loop
  select * into d from public.claim_mail_outbox();
  if d.outbox_id is null then return null; end if;
  if exists(select 1 from public.mail_outbox m where m.id=d.outbox_id and m.token_target_id=p_target) then
   return encode(extensions.digest(convert_to(d.delivery_token,'UTF8'),'sha256'),'hex');
  end if;
 end loop;
 return null;
end;
$$;
create function pg_temp.invitation_of(p_subject uuid) returns uuid language sql as $$
 select id from public.subject_invitations where target_kind='subject' and target_id=p_subject
  and invitation_kind='adult_subject' order by created_at desc limit 1
$$;
create function pg_temp.open_session(p_token_hash text,p_session text,p_form text) returns bigint language sql as $$
 select count(*) from public.activate_rights_session_v1(p_token_hash,repeat(p_session,64),p_form)
$$;
create function pg_temp.person_signs(p_session text,p_nonce text,p_keys text[] default array['knows-uploader-has-file',
 'agrees-to-upload','shown-what-uploader-sees','may-withdraw-any-time'],p_flag boolean default true) returns text language sql as $$
 select public.confirm_path_b_subject_v1(repeat(p_session,64),p_nonce,1,
  (select body_sha256 from public.consent_artifacts where artifact_key='consent.subject-adult-esignature' and version=1),
  p_keys,decode(repeat('cd',24),'hex'),'GB',p_flag);
$$;
-- A whole Path B setup for one person: draft, signature, request, the mailed
-- request's session and the person's own signature.
create function pg_temp.path_b(p_name text,p_letter text) returns uuid language plpgsql as $$
declare v_subject uuid;
begin
 perform pg_temp.draft(p_name,p_letter);
 v_subject:=pg_temp.sid(p_name);
 perform pg_temp.present(v_subject,p_letter);
 perform pg_temp.sign(v_subject,p_letter);
 perform pg_temp.invite(v_subject,repeat(p_letter,64),repeat(p_letter||'0',32));
 update fx set token_hash=pg_temp.claim_for(pg_temp.invitation_of(v_subject)),session_hash=repeat(p_letter,64) where name=p_name;
 if pg_temp.open_session((select token_hash from fx where name=p_name),p_letter,'path-b-open-'||p_letter||'aaaaaaaaaa')<>1
  or pg_temp.person_signs(p_letter,'path-b-sign-'||p_letter||'aaaaaaaaaa')<>'accepted' then
  raise exception 'path b setup failed for %',p_name; end if;
 return v_subject;
end;
$$;
create function pg_temp.issue(p_subject uuid,p_hash text,p_flag boolean default true,
 p_account uuid default '0a5e0000-0000-4000-8000-000000000001',p_session uuid default '0a5e0000-0000-4000-8000-000000000011')
returns jsonb language sql as $$
 select public.issue_other_adult_held_upload_v1(p_account,p_session,p_subject,'VCF',8,p_hash,p_flag);
$$;
-- The whole transport for one issued lease: the Storage write, finalization
-- and completion, exactly as the service route drives them.
create temporary table held_fx(name text primary key, upload_id uuid, staging text, final_name text, object_id uuid,
 raw text, revision_id uuid);
grant all on held_fx to service_role;
create function pg_temp.hold(p_name text,p_subject uuid,p_hash text) returns jsonb language plpgsql as $$
declare r jsonb; m jsonb; v_object uuid:=gen_random_uuid(); v_result jsonb;
begin
 r:=pg_temp.issue(p_subject,p_hash);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('role','service_role',true);
 insert into storage.objects(bucket_id,name,owner_id,metadata)
  values('genomes',r->>'stagingKey','0a5e0000-0000-4000-8000-000000000001','{"size":8}');
 m:=public.begin_own_upload_finalization_v2('0a5e0000-0000-4000-8000-000000000001',
  '0a5e0000-0000-4000-8000-000000000011',(r->>'uploadId')::uuid);
 insert into storage.objects(id,bucket_id,name,metadata) values(v_object,'genomes',m->>'finalKey','{"size":8}');
 perform set_config('role','postgres',true);
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where bucket_id='genomes' and name=r->>'stagingKey';
 perform set_config('role','service_role',true);
 v_result:=public.complete_own_upload_finalization_v1('0a5e0000-0000-4000-8000-000000000001',
  '0a5e0000-0000-4000-8000-000000000011',(r->>'uploadId')::uuid,(m->>'claim')::uuid,v_object,p_hash,repeat('b',64));
 perform set_config('role','postgres',true);
 insert into held_fx values(p_name,(r->>'uploadId')::uuid,r->>'stagingKey',m->>'finalKey',v_object,p_hash,
  (v_result->>'fileId')::uuid);
 return v_result;
end;
$$;
create function pg_temp.fxv(p_name text,p_field text) returns text language sql as $$
 select case p_field when 'upload' then upload_id::text when 'final' then final_name when 'object' then object_id::text
  when 'raw' then raw when 'staging' then staging when 'revision' then revision_id::text end from held_fx where name=p_name
$$;
create function pg_temp.notice_session(p_name text,p_session text) returns bigint language sql as $$
 select pg_temp.open_session(pg_temp.claim_for(pg_temp.fxv(p_name,'revision')::uuid),p_session,
  'notice-open-'||p_session||'aaaaaaaaaaaa')
$$;

-- 3. Reserving a Path B draft ----------------------------------------------------
select throws_ok($$select pg_temp.draft('x-flag','e',p_flag=>false)$$,'42501','not_found',
 'a Path B draft is reserved only under TEST-LOCAL');
select throws_ok($$select pg_temp.draft('x-minor','e',(timezone('UTC',clock_timestamp())::date-interval '18 years'+interval '1 day')::date)$$,
 '22023','subject_not_adult','the server refuses a date of birth under 18');
select throws_ok($$select pg_temp.draft('x-name','e',p_label=>'A')$$,'22023','invalid_request',
 'a name needs at least two characters');
select is((select r->>'state' from (select pg_temp.draft('main','a') r) x),'awaiting_uploader_artifact',
 'the uploader reserves a Path B draft; the next step is their own signature');
select is((select r->>'subjectDraftId' from (select pg_temp.draft('main-again','a') r) x),pg_temp.sid('main')::text,
 'the same request reserves the same draft once');
select ok((select d.adult_flow='path-b-subject-esignature' and d.confirmation_mode='path-b-token-or-account'
  and d.evidence_kind='esignature' and d.state='draft' and s.lifecycle='draft' and s.subject_class='other_adult'
  and s.owner_account_id='0a5e0000-0000-4000-8000-000000000001' and s.subject_account_id is null
  and s.display_label='Synthetic Relative' and dm.date_of_birth=date '1980-05-05'
 from public.adult_subject_drafts d join public.subjects s on s.id=d.subject_id
 join public.subject_demographics dm on dm.subject_id=s.id where d.subject_id=pg_temp.sid('main')),
 'the draft stores its flow, mode and evidence kind with the name and date of birth');
select throws_ok($$update public.adult_subject_drafts set adult_flow='path-a-own-account',confirmation_mode='path-a-account-required',
 evidence_kind='none',request_key=null where subject_id=pg_temp.sid('main')$$,'55000','immutable_adult_flow',
 'the flow never changes after the draft is reserved');

-- A Path A invitation from the same uploader, for contrast throughout.
create temporary table path_a as select * from public.create_adult_subject_invitation_v1('0a5e0000-0000-4000-8000-000000000001',
 decode('00112233445566778899aabbccddeeff','hex'),repeat('4',64),repeat('4',64),true,
 p_quota_keys=>pg_temp.invitation_quota_keys());
grant select on path_a to service_role;
insert into fx(name,subject_id,token_hash) select 'path-a',subject_id,pg_temp.claim_for(invitation_id) from path_a;

-- 4. The uploader's signature ----------------------------------------------------
select throws_ok($$select pg_temp.present(pg_temp.sid('main'),'7',false)$$,'42501','not_found',
 'the artifact is presented only under TEST-LOCAL');
select throws_ok($$select pg_temp.present(pg_temp.sid('main'),'7',true,'0a5e0000-0000-4000-8000-000000000009',
 '0a5e0000-0000-4000-8000-000000000019')$$,'42501','not_found','another account cannot sign for this draft');
select throws_ok($$select pg_temp.present(pg_temp.sid('path-a'),'7')$$,'42501','not_found',
 'a Path A invitation is never something the inviter can sign an upload for');
select is((select (p->>'artifactKey')||' v'||(p->>'artifactVersion') from (select pg_temp.present(pg_temp.sid('main'),'7') p) x),
 'consent.upload-other-adult v2','the uploader is presented the approved v2');
select throws_ok($$select pg_temp.sign(pg_temp.sid('main'),'7',p_version=>1)$$,'55000','consent_artifact_changed',
 'the superseded v1 can no longer be signed');
select throws_ok($$select pg_temp.sign(pg_temp.sid('main'),'7',array['subject-alive-and-adult'])$$,'22023','invalid_request',
 'every published statement must be affirmed, one by one');
select throws_ok($$select pg_temp.sign(pg_temp.sid('main'),'8')$$,'42501','not_found',
 'a signature needs a nonce the server presented');
-- Before signing, the request goes nowhere.
select is(pg_temp.invite(pg_temp.sid('main'),repeat('a',64),repeat('a1',32)),jsonb_build_object('status','received'),
 'the request before the uploader signs returns the same receipt');
select is((select count(*) from public.subject_invitations where target_id=pg_temp.sid('main')),0::bigint,
 '... and creates no invitation');
select is((select (s->>'recordKind')||' v'||(s->>'artifactVersion') from (select pg_temp.sign(pg_temp.sid('main'),'7') s) x),
 'artifact_signature v2','the uploader signs consent.upload-other-adult v2 for this exact draft');
select throws_ok($$select pg_temp.sign(pg_temp.sid('main'),'7')$$,'42501','not_found','a presented nonce signs once');

-- 5. The e-signature request -------------------------------------------------------
select throws_ok($$select pg_temp.invite(pg_temp.sid('main'),repeat('a',64),repeat('a2',32),false)$$,'42501','not_found',
 'the request is sent only under TEST-LOCAL');
select is(pg_temp.invite(pg_temp.sid('main'),repeat('f',64),repeat('a3',32)),jsonb_build_object('status','received'),
 'an address the draft does not hold returns the same receipt');
select is((select count(*) from public.subject_invitations where target_id=pg_temp.sid('main')),0::bigint,
 '... and creates no invitation');
select is(pg_temp.invite(pg_temp.sid('main'),repeat('a',64),repeat('a4',32)),jsonb_build_object('status','received'),
 'the signed draft sends its request');
select ok((select d.state='invited' and i.status='pending' and m.template_id='adult-subject-invitation'
  and m.template_payload=jsonb_build_object('request','esignature') and m.state='queued'
 from public.adult_subject_drafts d join public.subject_invitations i on i.target_id=d.subject_id
 join public.mail_outbox m on m.target_id=i.id where d.subject_id=pg_temp.sid('main')),
 'one pending invitation, and its mail asks for a signature, not an account');
select is(pg_temp.invite(pg_temp.sid('main'),repeat('a',64),repeat('a4',32)),jsonb_build_object('status','received'),
 'the same request again sends nothing new');
select is((select count(*) from public.subject_invitations where target_id=pg_temp.sid('main')),1::bigint,'still one invitation');
update fx set token_hash=pg_temp.claim_for(pg_temp.invitation_of(pg_temp.sid('main'))),session_hash=repeat('a',64) where name='main';
select ok((select token_hash is not null from fx where name='main'),'the request mail carries a credential');
select throws_ok($$select pg_temp.issue(pg_temp.sid('main'),repeat('e',64))$$,'42501','not_found',
 'before the person signs, the uploader cannot upload');

-- 6. The person signs, without an account -------------------------------------------
select is(pg_temp.open_session((select token_hash from fx where name='main'),'a','path-b-open-aaaaaaaaaaaaaaaaaa'),1::bigint,
 'the person opens the request');
select is(public.respond_adult_subject_invitation_session_v1(repeat('a',64),'confirm','path-b-account-aaaaaaaaaaaaaa',
 '0a5e0000-0000-4000-8000-000000000002',repeat('a',64)),'unavailable',
 'Path A''s account acceptance cannot confirm a Path B request');
select is(pg_temp.person_signs('a','path-b-keys-aaaaaaaaaaaaaaaaa',array['knows-uploader-has-file']),'unavailable',
 'every one of the four statements must be affirmed');
select is(pg_temp.person_signs('a','path-b-flag-aaaaaaaaaaaaaaaaa',p_flag=>false),'unavailable',
 'the person signs only under TEST-LOCAL');
select is(pg_temp.person_signs('a','path-b-sign-aaaaaaaaaaaaaaaaa'),'accepted','the person signs their own artifact');
select ok((select s.lifecycle='active' and s.owner_account_id='0a5e0000-0000-4000-8000-000000000001'
  and s.subject_account_id is null and d.state='confirmed' and sp.status='active' and sp.account_id is null
  and e.authority_revision=sp.principal_revision and i.status='accepted'
 from public.subjects s join public.adult_subject_drafts d on d.subject_id=s.id
 join public.subject_principals sp on sp.subject_id=s.id and sp.principal_kind='non_account_subject'
 join public.encrypted_contact_references e on e.principal_id=sp.id and e.status='current'
 join public.subject_invitations i on i.target_id=s.id where s.id=pg_temp.sid('main')),
 'an uploader-owned other_adult subject with one active non-account principal and a live contact');
select ok((select cs.signer_account_id is null and cs.purpose='adult-subject-path-b-confirmation' and cs.jurisdiction_code='GB'
  and cs.statement_keys=array['knows-uploader-has-file','agrees-to-upload','shown-what-uploader-sees','may-withdraw-any-time']
  and cs.subject_binding_revision=(select subject_binding_revision from public.subjects where id=pg_temp.sid('main'))
 from public.consent_signatures cs where cs.target_id=pg_temp.sid('main') and cs.artifact_key='consent.subject-adult-esignature'),
 'the person''s signature records the four statements, their country and the new binding revision');
select is(pg_temp.person_signs('a','path-b-again-aaaaaaaaaaaaaaaa'),'unavailable','the request is answered once');

-- 7. Path A never receives an inviter upload ----------------------------------------
-- Forge the one thing signing refuses, the inviter's store consent on a Path A
-- reservation, so that only the flow rule stands between it and an upload.
create function pg_temp.forge_store_consent(p_subject uuid) returns void language plpgsql as $$
declare v_signature uuid;
begin
 insert into public.consent_signatures(artifact_key,artifact_version,artifact_body_sha256,signer_principal_id,
  signer_account_id,target_kind,target_id,purpose,statement_keys,signing_name_encrypted,jurisdiction_code,
  jurisdiction_revision,subject_binding_revision)
 select a.artifact_key,a.version,a.body_sha256,sp.id,'0a5e0000-0000-4000-8000-000000000001','subject',p_subject,
  'other-adult-upload',array['subject-alive-and-adult','subject-permission-held','lawfully-held-with-knowledge',
   'contact-belongs-to-subject','no-excluded-relationship','held-until-accepted','no-uploader-access'],
  decode(repeat('ab',24),'hex'),'ZZ',p.jurisdiction_revision,s.subject_binding_revision
 from public.consent_artifacts a, public.subject_principals sp, public.profiles p, public.subjects s
 where a.artifact_key='consent.upload-other-adult' and a.superseded_at is null and s.id=p_subject
  and p.id='0a5e0000-0000-4000-8000-000000000001' and sp.account_id=p.id and sp.principal_kind='account_subject'
  and sp.subject_id=(select id from public.subjects where subject_account_id=p.id and subject_class='self')
 returning id into v_signature;
 insert into public.subject_consents(signature_id,subject_id,account_id,consent_type,scope,grant_revision)
 values(v_signature,p_subject,'0a5e0000-0000-4000-8000-000000000001','upload_class',array['store'],1);
end;
$$;
select pg_temp.forge_store_consent(pg_temp.sid('path-a'));
select throws_ok($$select pg_temp.issue(pg_temp.sid('path-a'),repeat('e',64))$$,'42501','not_found',
 'a Path A invitation cannot receive an inviter upload, even with a store consent in place');

-- 8. No signature, no upload; wrong actors; wrong jurisdictions --------------------
select pg_temp.path_b('unsigned','b');
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where subject_id=pg_temp.sid('unsigned') and account_id='0a5e0000-0000-4000-8000-000000000001' and revoked_at is null;
select throws_ok($$select pg_temp.issue(pg_temp.sid('unsigned'),repeat('e',64))$$,'55000','upload_consent_required',
 'without the uploader''s current signature there is no upload');
select throws_ok($$select pg_temp.issue(pg_temp.sid('main'),repeat('e',64),false)$$,'42501','not_found',
 'the held-upload branch is closed outside TEST-LOCAL');
select throws_ok($$select pg_temp.issue(pg_temp.sid('main'),repeat('e',64),true,'0a5e0000-0000-4000-8000-000000000009',
 '0a5e0000-0000-4000-8000-000000000019')$$,'42501','not_found','another account cannot upload for this subject');
select throws_ok($$select public.issue_own_storage_upload_v1('0a5e0000-0000-4000-8000-000000000001',
 '0a5e0000-0000-4000-8000-000000000011',pg_temp.sid('main'),'VCF',8,repeat('e',64))$$,'42501','not_found',
 'the own-subject issuer still refuses the uploader for another adult''s subject');
-- Consent is rechecked at every transport step, not only at issuance.
create function pg_temp.stage_after_revocation(p_subject uuid) returns void language plpgsql as $$
declare r jsonb;
begin
 r:=pg_temp.issue(p_subject,repeat('9',64));
 update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
  where subject_id=p_subject and account_id='0a5e0000-0000-4000-8000-000000000001'
   and consent_type='upload_class' and revoked_at is null;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('role','service_role',true);
 insert into storage.objects(bucket_id,name,owner_id,metadata)
  values('genomes',r->>'stagingKey','0a5e0000-0000-4000-8000-000000000001','{"size":8}');
end;
$$;
select pg_temp.path_b('revoked','c');
select throws_ok($$select pg_temp.stage_after_revocation(pg_temp.sid('revoked'))$$,'42501','upload_unavailable',
 'a withdrawn uploader consent stops the Storage write of a lease already issued');

-- The other Path B people of this suite, set up before any file is held so
-- every mail claim above and below is for its own target.
select pg_temp.path_b('expire','d');
select pg_temp.path_b('delete','e');
select pg_temp.path_b('withdraw','f');

-- 9. Upload and hold -----------------------------------------------------------------
create temporary table main_receipt as select pg_temp.hold('main',pg_temp.sid('main'),repeat('e',64)) r;
grant select on main_receipt to service_role;
select is((select jsonb_agg(k order by k) from main_receipt,jsonb_object_keys(r) k),
 '["analysisState","fileId","noticeState","status"]'::jsonb,
 'the finalize receipt has exactly the register''s other-adult keys');
select is((select r-'fileId' from main_receipt),
 jsonb_build_object('status','stored_quarantined','analysisState','quarantined','noticeState','queued'),
 'stored and quarantined, with the notice queued');
select ok((select h.id=(r->>'fileId')::uuid from main_receipt,public.other_adult_held_uploads h
 where h.upload_session_id=pg_temp.fxv('main','upload')::uuid),'the fileId is the held revision''s own opaque id');
select ok((select status='held' and finalized_file_id is null and consumed_at is null and upload_authority_kind='other-adult-held'
 from public.upload_sessions where id=pg_temp.fxv('main','upload')::uuid),'the session is held, with no file');
select ok((select h.state='pending' and h.analysis_state='quarantined' and h.confirmed_at is null
  and h.uploader_account_id='0a5e0000-0000-4000-8000-000000000001'
  and h.confirmation_principal_id=(select id from public.subject_principals where subject_id=pg_temp.sid('main')
   and principal_kind='non_account_subject')
  and h.fixed_deadline=h.held_at+interval '30 days'
 from public.other_adult_held_uploads h where h.id=pg_temp.fxv('main','revision')::uuid),
 'the revision is pending, bound to the person''s principal, with a fixed 30-day deadline');
-- upload-time-rights-notice-v1: in the same commit, one notice to the person's
-- own stored contact, and one confirmation credential for exactly this revision.
select ok((select count(*)=1 and bool_and(m.template_id='adult-upload-notice' and m.purpose='adult-upload-confirmation'
  and m.token_purpose='adult-upload-confirmation' and m.target_kind='adult_upload_revision' and m.state='queued'
  and m.recipient_principal_id=h.confirmation_principal_id and m.expires_at=h.fixed_deadline
  and m.contact_reference_id=(select e.id from public.encrypted_contact_references e
   where e.principal_id=h.confirmation_principal_id and e.status='current')
  and m.template_payload ? 'uploadedOn' and not (m.template_payload ? 'name')
  and exists(select 1 from public.token_candidates tc where tc.outbox_id=m.id and tc.target_id=h.id
   and tc.purpose='adult-upload-confirmation' and tc.state='pending'))
 from public.other_adult_held_uploads h join public.mail_outbox m on m.id=h.notice_outbox_id and m.target_id=h.id
 where h.id=pg_temp.fxv('main','revision')::uuid),
 'the same commit queues the upload-time notice and its credential');
select ok((select d.status='pending' and d.phase_deadline=h.fixed_deadline from public.retention_due_phases d
 join public.other_adult_held_uploads h on h.upload_session_id=d.target_id
 where d.retention_id='adult.unconfirmed-30d' and d.phase_id='adult-unconfirmed-source-expiry'
  and d.target_id=pg_temp.fxv('main','upload')::uuid),'adult.unconfirmed-30d is scheduled at the fixed deadline');
select throws_ok($$select pg_temp.issue(pg_temp.sid('main'),repeat('f',64))$$,'55000','upload_unavailable',
 'one pending revision per person');
select is(public.begin_own_upload_finalization_v2('0a5e0000-0000-4000-8000-000000000001',
 '0a5e0000-0000-4000-8000-000000000011',pg_temp.fxv('main','upload')::uuid),
 jsonb_build_object('status','held','fileId',pg_temp.fxv('main','revision')::uuid),
 'finalizing again only reports the held revision');

-- 10. Quarantined: unreadable by every reader -------------------------------------
create function pg_temp.no_file_rows(p_name text) returns bigint language sql as $$
 select (select count(*) from public.genome_files where bucket_path=pg_temp.fxv(p_name,'final')
  or storage_object_id=pg_temp.fxv(p_name,'object')::uuid or sha256=pg_temp.fxv(p_name,'raw')
  or id=pg_temp.fxv(p_name,'revision')::uuid)
 +(select count(*) from public.genome_storage_objects where object_id=pg_temp.fxv(p_name,'object')::uuid
  or object_name=pg_temp.fxv(p_name,'final'))
$$;
select is(pg_temp.no_file_rows('main'),0::bigint,
 'a held source has no genome_files or genome_storage_objects row, so no file reader can address it');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('main')),0::bigint,'no job exists for it');
select is((select count(*) from public.purpose_grants where target_id=pg_temp.sid('main')),0::bigint,
 'no analytic purpose exists for it');
-- Only these reviewed lifecycle functions name the held table. The Path B
-- normalization/read gates inspect current source evidence without granting
-- browser access to the held table or returning its raw descriptor.
select is((select string_agg(n.nspname||'.'||p.proname,', ' order by n.nspname,p.proname)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prosrc like '%other_adult_held_uploads%'),
 'private.adult_upload_mail_current_v1, private.adult_upload_revision_session_v1, ' || case when to_regprocedure('private.assert_account_path_b_deletion_supported_v1(uuid)') is null
   then '' else 'private.assert_account_path_b_deletion_supported_v1, ' end || 'private.begin_own_upload_finalization_v2, private.complete_own_upload_finalization_v1, private.delete_path_b_subject_v1, private.end_other_adult_held_upload_v1, private.enqueue_path_b_normalization_v1, ' || case when to_regprocedure('private.export_account_class_inventory_v1(uuid,jsonb)') is null
   then '' else 'private.export_account_class_inventory_v1, ' end || case when to_regprocedure('private.export_account_path_b_snapshot_v1(jsonb,uuid)') is null then '' else 'private.export_account_path_b_snapshot_v1, ' end || 'private.issue_other_adult_held_upload_v1, private.other_adult_upload_targets_v1, private.own_upload_finalization_v1, private.path_b_normalization_authority_v1, private.path_b_normalization_v1, private.path_b_result_read_v1, private.subject_held_files_v1, ' || case when to_regprocedure('public.activate_rights_session_before_keyless_objection_v1(text,text,text)') is null
   then 'public.activate_rights_session_v1' else 'public.activate_rights_session_before_keyless_objection_v1' end || ', public.expire_due_other_adult_held_uploads_v1, public.respond_adult_upload_revision_v1','the held table is named only by the exact reviewed lifecycle functions');
select ok((select md5(prosrc)='7c176e100123ecbdf9aedd8ee41b0539' from pg_proc
 where oid=coalesce(to_regprocedure('public.activate_rights_session_before_keyless_objection_v1(text,text,text)'),
   to_regprocedure('public.activate_rights_session_v1(text,text,text)')))
 and has_function_privilege('service_role','public.activate_rights_session_v1(text,text,text)','execute')
 and not exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only']) r
   where has_function_privilege(r,'public.activate_rights_session_v1(text,text,text)','execute'))
 and (to_regprocedure('public.activate_rights_session_before_keyless_objection_v1(text,text,text)') is null
   or ((select md5(prosrc)='5f92f26f9e5f94f7593f833d17db7d6c' from pg_proc
     where oid='public.activate_rights_session_v1(text,text,text)'::regprocedure)
    and not exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r
      where has_function_privilege(r,to_regprocedure('public.activate_rights_session_before_keyless_objection_v1(text,text,text)'),'execute')))),
 'the exact held activation body is only behind the current service door; the actual023 delegate remains API-denied');
select ok(to_regprocedure('private.assert_account_path_b_deletion_supported_v1(uuid)') is null
 or ((select md5(prosrc)='6382fbb06d5525dc983806ecefebb629' from pg_proc
    where oid=to_regprocedure('private.assert_account_path_b_deletion_supported_v1(uuid)'))
   and not exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role'])r
    where has_function_privilege(r,to_regprocedure('private.assert_account_path_b_deletion_supported_v1(uuid)'),'execute'))),
 'only the exact installed account Path B refusal helper may join the lifecycle census, with every API role denied');
select ok(to_regprocedure('private.export_account_class_inventory_v1(uuid,jsonb)') is null
 or ((select md5(prosrc)='66d3fffa8f2cdcc069e89ccb25478db3' and prosecdef and proconfig=array['search_path=""','lock_timeout=250ms']::text[]
  and proowner=(select oid from pg_roles where rolname='postgres') from pg_proc
  where oid=to_regprocedure('private.export_account_class_inventory_v1(uuid,jsonb)'))
  and not exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role'])r
   where has_function_privilege(r,to_regprocedure('private.export_account_class_inventory_v1(uuid,jsonb)'),'execute'))),
 'only the exact installed account class inventory may inspect held custody, behind every API denial');
select is((select jsonb_agg(distinct k order by k) from jsonb_array_elements(
 public.other_adult_upload_targets_v1('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',true)) t,
 jsonb_object_keys(t) k),
 '["answerBy","label","latest","requestedAt","signed","state","subjectId"]'::jsonb,
 'the uploader''s view carries a name they typed, states and dates only, never an object, hash or address');
select is((select t->'latest'->>'state' from jsonb_array_elements(public.other_adult_upload_targets_v1(
 '0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',true)) t
 where t->>'subjectId'=pg_temp.sid('main')::text),'pending','the uploader sees one line: waiting for the person');
select is(public.other_adult_upload_targets_v1('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',false),
 '[]'::jsonb,'outside TEST-LOCAL the uploader sees nothing');

-- Every account-and-session function (the reader family: its first two
-- arguments are an account and its session, its third a uuid target) is
-- called by every account in this suite against the person's subject, each
-- account's own subject and every held identifier. Each either refuses or
-- returns nothing that names the held source: not its object, its object id,
-- its hash, its session or its revision. The set comes from the catalogue, so
-- a reader added later is probed too. Each call runs in a subtransaction that
-- is always rolled back, so a writer in the family changes nothing.
create temporary table reader_calls(stage text, fn text, args text, outcome text);
create function pg_temp.probe(p_stage text,p_account uuid,p_session uuid,p_target uuid) returns void language plpgsql as $$
declare f record; v_sql text; v_out text; v_rest text; v_needles text[]; v_done boolean;
begin
 v_needles:=array[pg_temp.fxv('main','final'),pg_temp.fxv('main','object'),pg_temp.fxv('main','raw'),
  pg_temp.fxv('main','upload'),pg_temp.fxv('main','staging')];
 for f in select p.oid,n.nspname,p.proname,p.proargtypes
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prokind='f' and p.pronargs>=3
   and (p.proargnames)[1] in ('p_account_id','p_account') and (p.proargnames)[2] in ('p_session_id','p_session')
   and p.proargtypes[0]='uuid'::regtype and p.proargtypes[1]='uuid'::regtype and p.proargtypes[2]='uuid'::regtype
  order by 2,3
 loop
  select string_agg(format('null::%s',format_type(t,null)),',' order by o) into v_rest
   from unnest(f.proargtypes::oid[]) with ordinality u(t,o) where o>3;
  v_sql:=format('select coalesce(string_agg(r::text,%L),%L) from %I.%I(%L::uuid,%L::uuid,%L::uuid%s) r',',','',
   f.nspname,f.proname,p_account,p_session,p_target,coalesce(','||v_rest,''));
  v_out:=null; v_done:=false;
  begin
   execute v_sql into v_out;
   v_done:=true;
   raise exception using errcode='P0001',message='probe_rollback';
  exception when others then
   insert into reader_calls values(p_stage,f.nspname||'.'||f.proname,p_account||'/'||p_target,
    case when not v_done then 'refused'
     when exists(select 1 from unnest(v_needles) x where x is not null and x<>p_target::text
      and position(x in coalesce(v_out,''))>0) then 'LEAKED'
     when position(pg_temp.fxv('main','revision') in coalesce(v_out,''))>0
      and p_target::text<>pg_temp.fxv('main','revision') then 'REVISION'
     else 'returned-nothing-held' end);
  end;
 end loop;
end;
$$;
create function pg_temp.probe_all(p_stage text) returns void language plpgsql as $$
begin
 perform pg_temp.probe(p_stage,'0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',pg_temp.sid('main'));
 perform pg_temp.probe(p_stage,'0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',
  (select id from public.subjects where subject_account_id='0a5e0000-0000-4000-8000-000000000001' and subject_class='self'));
 perform pg_temp.probe(p_stage,'0a5e0000-0000-4000-8000-000000000002','0a5e0000-0000-4000-8000-000000000012',pg_temp.sid('main'));
 perform pg_temp.probe(p_stage,'0a5e0000-0000-4000-8000-000000000002','0a5e0000-0000-4000-8000-000000000012',
  (select id from public.subjects where subject_account_id='0a5e0000-0000-4000-8000-000000000002' and subject_class='self'));
 perform pg_temp.probe(p_stage,'0a5e0000-0000-4000-8000-000000000009','0a5e0000-0000-4000-8000-000000000019',pg_temp.sid('main'));
 perform pg_temp.probe(p_stage,'0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',pg_temp.fxv('main','revision')::uuid);
 perform pg_temp.probe(p_stage,'0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',pg_temp.fxv('main','upload')::uuid);
 perform pg_temp.probe(p_stage,'0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',pg_temp.fxv('main','object')::uuid);
 perform pg_temp.probe(p_stage,'0a5e0000-0000-4000-8000-000000000009','0a5e0000-0000-4000-8000-000000000019',pg_temp.fxv('main','revision')::uuid);
end;
$$;
select pg_temp.probe_all('pending');
select cmp_ok((select count(distinct fn) from reader_calls where stage='pending'),'>=',100::bigint,
 'the reader probe discovered the whole account-and-session function family');
select is((select coalesce(string_agg(distinct fn,', '),'') from reader_calls where stage='pending' and outcome='LEAKED'),'',
 'quarantined source is unreadable by every reader function');
-- The revision's opaque id is the fileId of the uploader's own receipt; only
-- the uploader's own finalization call reads it back, for their own upload.
select is((select string_agg(distinct fn||' for '||args,', ' order by fn||' for '||args) from reader_calls
 where stage='pending' and outcome='REVISION'),
 'private.begin_own_upload_finalization_v2 for 0a5e0000-0000-4000-8000-000000000001/'||pg_temp.fxv('main','upload')
 ||', public.begin_own_upload_finalization_v1 for 0a5e0000-0000-4000-8000-000000000001/'||pg_temp.fxv('main','upload')
 ||', public.begin_own_upload_finalization_v2 for 0a5e0000-0000-4000-8000-000000000001/'||pg_temp.fxv('main','upload'),
 'the revision id reaches no one but the uploader, and only as their own receipt');
select is((select count(*) from reader_calls where stage='pending'
 and fn in ('private.own_upload_store_authority_v1','private.own_upload_context_v1')
 and args='0a5e0000-0000-4000-8000-000000000001/'||pg_temp.sid('main')::text and outcome='refused'),2::bigint,
 'the own-subject authority itself refuses the uploader for the person''s subject');
-- The account-wide export list, which is not subject-scoped, answers the
-- uploader (whose own store consent is live) and lists nothing held.
select is(public.own_subject_export_content_v1('list','0a5e0000-0000-4000-8000-000000000001',
 '0a5e0000-0000-4000-8000-000000000011'),'[]'::jsonb,'the uploader''s own export lists no file at all');

-- 11. The notice reaches the person, and opens a session for this revision ----------
create temporary table notice as select m.id as outbox_id,null::text as token_hash
 from public.mail_outbox m where m.target_id=pg_temp.fxv('main','revision')::uuid;
grant select on notice to service_role;
update notice set token_hash=pg_temp.claim_for(pg_temp.fxv('main','revision')::uuid);
select ok((select token_hash is not null from notice),'the mail worker mints the notice credential');
select ok((select tc.purpose='adult-upload-confirmation' and tc.target_kind='adult_upload_revision'
 and tc.target_id=h.id and tc.outbox_id=h.notice_outbox_id and tc.state='issued'
 and th.status='current' and th.token_revision=tc.token_revision and th.token_hash=n.token_hash
 and tc.expires_at<=h.fixed_deadline and tc.expires_at>clock_timestamp()
 from notice n join public.token_candidates tc on tc.outbox_id=n.outbox_id
 join public.token_hashes th on th.candidate_id=tc.id and th.token_hash=n.token_hash
 join public.other_adult_held_uploads h on h.id=tc.target_id),
 'the real claim issues only the exact held notice hash, revision and original fixed deadline');
create function pg_temp.held_submission_refuses(p_case text) returns boolean language plpgsql as $$
declare allowed boolean; before_rows jsonb; after_rows jsonb;
begin
 select jsonb_build_object('held',to_jsonb(h),'subject',to_jsonb(s),'candidate',to_jsonb(tc),
  'token',to_jsonb(th),'mail',to_jsonb(m),'contact',to_jsonb(e)) into before_rows
 from notice n join public.mail_outbox m on m.id=n.outbox_id
 join public.other_adult_held_uploads h on h.id=m.target_id
 join public.subjects s on s.id=h.subject_id join public.token_candidates tc on tc.outbox_id=m.id
 join public.token_hashes th on th.candidate_id=tc.id and th.token_hash=n.token_hash
 join public.encrypted_contact_references e on e.id=m.contact_reference_id;
 begin
  if p_case='candidate-expired' then
   update public.token_candidates set expires_at=clock_timestamp()-interval '1 second'
    where outbox_id=(select outbox_id from notice);
  elsif p_case='token-revoked' then
   update public.token_hashes set status='revoked',ended_at=clock_timestamp()
    where token_hash=(select token_hash from notice);
  elsif p_case='subject-revision' then
   update public.subjects set subject_binding_revision=subject_binding_revision+1 where id=pg_temp.sid('main');
  else raise exception 'unknown submission counterexample';end if;
  allowed:=public.authorize_mail_submission_v1((select outbox_id from notice),
   (select attempt_count from public.mail_outbox where id=(select outbox_id from notice)));
  raise exception using errcode='P2500',message='rollback exact submission counterexample';
 exception when sqlstate 'P2500' then null;
 end;
 select jsonb_build_object('held',to_jsonb(h),'subject',to_jsonb(s),'candidate',to_jsonb(tc),
  'token',to_jsonb(th),'mail',to_jsonb(m),'contact',to_jsonb(e)) into after_rows
 from notice n join public.mail_outbox m on m.id=n.outbox_id
 join public.other_adult_held_uploads h on h.id=m.target_id
 join public.subjects s on s.id=h.subject_id join public.token_candidates tc on tc.outbox_id=m.id
 join public.token_hashes th on th.candidate_id=tc.id and th.token_hash=n.token_hash
 join public.encrypted_contact_references e on e.id=m.contact_reference_id;
 return allowed is false and before_rows=after_rows;
end $$;
select ok(pg_temp.held_submission_refuses('candidate-expired'),
 'an expired real held candidate refuses submission and rolls back its complete source/mail/contact tuple');
select ok(pg_temp.held_submission_refuses('token-revoked'),
 'a revoked real held token refuses submission and rolls back its complete source/mail/contact tuple');
select ok(pg_temp.held_submission_refuses('subject-revision'),
 'a changed subject revision refuses submission and rolls back its complete source/mail/contact tuple');
select is(public.authorize_mail_submission_v1((select outbox_id from notice),
 (select attempt_count from public.mail_outbox where id=(select outbox_id from notice))),true,
 'the notice may be submitted while its revision is pending');
--025: each counterexample uses the actual already-issued notice credential.
-- The subtransaction always rolls back; no expired/revision replacement is kept.
create function pg_temp.held_activation_refuses(p_case text) returns boolean
language plpgsql as $$
declare v_count bigint; v_sessions bigint; v_nonce_count bigint; v_before jsonb; v_after jsonb;
begin
 select jsonb_build_object('held',to_jsonb(h),'subject',to_jsonb(s),'candidate',to_jsonb(tc),'token',to_jsonb(th)) into v_before
 from public.other_adult_held_uploads h join public.subjects s on s.id=h.subject_id
 join public.token_candidates tc on tc.target_id=h.id and tc.outbox_id=h.notice_outbox_id
 join public.token_hashes th on th.candidate_id=tc.id where h.id=pg_temp.fxv('main','revision')::uuid;
 select count(*) into v_sessions from public.rights_sessions;
 select count(*) into v_nonce_count from public.embryo_operation_nonces;
 begin
  if p_case='candidate-expired' then
   update public.token_candidates set expires_at=clock_timestamp()-interval '1 second'
    where target_id=pg_temp.fxv('main','revision')::uuid;
  elsif p_case='token-revision' then
   update public.token_hashes set token_revision=token_revision+1
    where token_hash=(select token_hash from notice);
  elsif p_case='subject-revision' then
   update public.subjects set subject_binding_revision=subject_binding_revision+1 where id=pg_temp.sid('main');
  else raise exception 'unknown activation counterexample';end if;
  select count(*) into v_count from public.activate_rights_session_v1((select token_hash from notice),
   encode(extensions.digest('bridge:'||p_case,'sha256'),'hex'),'bridge-'||p_case||'-aaaaaaaaaaaaaaaa');
  raise exception using errcode='P2500',message='rollback exact activation counterexample';
 exception when sqlstate 'P2500' then null;
 end;
 select jsonb_build_object('held',to_jsonb(h),'subject',to_jsonb(s),'candidate',to_jsonb(tc),'token',to_jsonb(th)) into v_after
 from public.other_adult_held_uploads h join public.subjects s on s.id=h.subject_id
 join public.token_candidates tc on tc.target_id=h.id and tc.outbox_id=h.notice_outbox_id
 join public.token_hashes th on th.candidate_id=tc.id where h.id=pg_temp.fxv('main','revision')::uuid;
 return v_count=0 and v_before=v_after
  and v_sessions=(select count(*) from public.rights_sessions)
  and v_nonce_count=(select count(*) from public.embryo_operation_nonces);
end $$;
select ok(pg_temp.held_activation_refuses('candidate-expired'),
 'an expired genuine held notice issues zero session and rolls back its entire source and nonce tuple');
select ok(pg_temp.held_activation_refuses('token-revision'),
 'a crossed token revision issues zero session and rolls back its entire source and nonce tuple');
select ok(pg_temp.held_activation_refuses('subject-revision'),
 'a changed actual subject revision issues zero session and rolls back its entire source and nonce tuple');
select ok(has_function_privilege('service_role','public.activate_rights_session_v1(text,text,text)','execute')
 and not has_function_privilege('anon','public.activate_rights_session_v1(text,text,text)','execute')
 and not has_function_privilege('authenticated','public.activate_rights_session_v1(text,text,text)','execute')
 and not has_function_privilege('inherit_upload_only','public.activate_rights_session_v1(text,text,text)','execute'),
 'only the service activation door is callable; browser/upload roles gain no issuer authority');
set local role service_role;
select is(pg_temp.open_session((select token_hash from notice),'1','notice-open-kkkkkkkkkkkkkkkk'),1::bigint,
 'the notice link opens a rights session without an account');
reset role;
select is(pg_temp.open_session((select token_hash from notice),'8','bridge-consumed-aaaaaaaaaaaaaaaa'),0::bigint,
 'the already consumed real notice token cannot open a second session');
select ok((select rs.purpose='adult-upload-confirmation' and rs.target_kind='adult_upload_revision'
  and rs.target_id=pg_temp.fxv('main','revision')::uuid and rs.principal_id=h.confirmation_principal_id
  and rs.expires_at<=h.fixed_deadline
 from public.rights_sessions rs,public.other_adult_held_uploads h
 where rs.session_hash=repeat('1',64) and h.id=pg_temp.fxv('main','revision')::uuid),
 'the session is bound to exactly this revision and the person''s principal');
select is((select jsonb_agg(k order by k) from jsonb_object_keys(public.read_adult_upload_revision_v1(repeat('1',64))) k),
 '["addedOn","confirmedOn","deleteBy","fileKind","label","state"]'::jsonb,
 'the person''s read-only view is exactly the uploader''s own view: a name, a kind, dates and a state');
select is(public.read_adult_upload_revision_v1(repeat('0',64)),null,'another session reads nothing');

-- 12. Confirmation: this revision only, and still nothing reads it --------------------
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'confirm-kkkkkkkkkkkkkkkkkkkkkk','confirm'),'confirmed',
 'the person confirms this revision');
select ok((select state='confirmed' and confirmed_at is not null and analysis_state='confirmed_blocked_current_gate'
 from public.other_adult_held_uploads where id=pg_temp.fxv('main','revision')::uuid),
 'the revision is confirmed with the register''s confirmed_blocked_current_gate outcome');
select is(pg_temp.no_file_rows('main'),0::bigint,'confirmation makes no genome_files row');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('main')),0::bigint,
 'confirmation enqueues nothing');
select is((select count(*) from public.purpose_grants where target_id=pg_temp.sid('main')),0::bigint,
 'confirmation grants no purpose');
select is((select status||':'||terminal_outcome_code from public.retention_due_phases
 where retention_id='adult.unconfirmed-30d' and target_id=pg_temp.fxv('main','upload')::uuid),
 'cancelled:subject_confirmed','its unconfirmed-file clock ends');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'confirm-again-kkkkkkkkkkkkkkkk','confirm'),'unavailable',
 'a revision is confirmed once');
select pg_temp.probe_all('confirmed');
select is((select coalesce(string_agg(distinct fn,', '),'') from reader_calls where stage='confirmed' and outcome='LEAKED'),'',
 'a confirmed source is still unreadable by every reader function until its analysis gate exists');

-- 13. A second revision, refused: only that file ends, then it is purged ----------------
select is((select h->>'status' from (select pg_temp.hold('main-2',pg_temp.sid('main'),repeat('a',64)) h) x),'stored_quarantined',
 'the uploader adds a second file');
select is(pg_temp.notice_session('main-2','2'),1::bigint,'its own notice opens its own session');
select is((public.read_adult_upload_revision_v1(repeat('1',64))->>'state')||'/'||
 (public.read_adult_upload_revision_v1(repeat('2',64))->>'state'),'confirmed/pending',
 'each notice session is bound to its own revision');
select is(public.respond_adult_upload_revision_v1(repeat('2',64),'refuse-lllllllllllllllllllllll','refuse'),'refused',
 'the person refuses the second file without an account');
select ok((select h.state='refused' and u.status='rejected' and u.consumed_at is not null and u.finalization_cleanup_pending
  and u.expires_at<=clock_timestamp()
 from public.other_adult_held_uploads h join public.upload_sessions u on u.id=h.upload_session_id
 where h.id=pg_temp.fxv('main-2','revision')::uuid),'the refused revision''s session is rejected and due now');
select ok((select state='confirmed' from public.other_adult_held_uploads where id=pg_temp.fxv('main','revision')::uuid)
 and (select lifecycle='active' from public.subjects where id=pg_temp.sid('main')),
 'refusal ends only that revision: the first file and the person''s confirmation stay');
select is((select status||':'||terminal_outcome_code from public.retention_due_phases
 where retention_id='adult.unconfirmed-30d' and target_id=pg_temp.fxv('main-2','upload')::uuid),
 'cancelled:subject_refused','its adult.unconfirmed-30d clock ends as refused');
create function pg_temp.purge_claim(p_upload uuid) returns jsonb language plpgsql as $$
declare c jsonb; i integer;
begin
 for i in 1..200 loop
  c:=public.claim_own_upload_purge_v1(encode(extensions.digest(convert_to(p_upload::text||i,'UTF8'),'sha256'),'hex'));
  if c is null then return null; end if;
  if exists(select 1 from public.purge_manifests m join public.retention_due_phases d on d.retention_row_id=m.retention_row_id
   and d.phase_id=m.phase_id where m.id=(c->>'manifestId')::uuid and d.target_id=p_upload) then
   return c||jsonb_build_object('claimToken',encode(extensions.digest(convert_to(p_upload::text||i,'UTF8'),'sha256'),'hex'));
  end if;
 end loop;
 return null;
end;
$$;
-- The executor takes the earliest due phase first. On a shared developer
-- database older due sessions may exist; putting this one first changes only
-- the order of work, never which sessions are eligible.
update public.retention_due_phases set phase_deadline=clock_timestamp()-interval '10 years'
 where retention_id='upload.staging-2h' and target_id=pg_temp.fxv('main-2','upload')::uuid;
create temporary table refused_claim as select pg_temp.purge_claim(pg_temp.fxv('main-2','upload')::uuid) c;
grant select on refused_claim to service_role;
select is((select jsonb_agg(o->>'objectName' order by o->>'objectName') from refused_claim,jsonb_array_elements(c->'objects') o),
 (select jsonb_agg(x order by x) from unnest(array[pg_temp.fxv('main-2','staging'),pg_temp.fxv('main-2','final')]) x),
 'the existing executor claims exactly the staging and final objects of the refused file');
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where bucket_id='genomes' and name in (pg_temp.fxv('main-2','staging'),pg_temp.fxv('main-2','final'));
select is(public.finish_own_upload_purge_v1((select (c->>'manifestId')::uuid from refused_claim),
 (select c->>'claimToken' from refused_claim)),true,'the executor finishes after Storage deletion');
select is((select count(*) from public.upload_sessions where id=pg_temp.fxv('main-2','upload')::uuid)
 +(select count(*) from public.other_adult_held_uploads where id=pg_temp.fxv('main-2','revision')::uuid)
 +pg_temp.no_file_rows('main-2')
 +(select count(*) from storage.objects where name in (pg_temp.fxv('main-2','staging'),pg_temp.fxv('main-2','final'))),0::bigint,
 'after refusal: zero session, revision, file and Storage rows remain');

-- 14. The person deletes everything ------------------------------------------------------
select is((select h->>'status' from (select pg_temp.hold('delete',pg_temp.sid('delete'),repeat('c',64)) h) x),'stored_quarantined',
 '(delete) held');
select is(pg_temp.notice_session('delete','3'),1::bigint,'(delete) the notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('3',64),'delete-mmmmmmmmmmmmmmmmmmmmmmm','delete'),'deleted',
 'the person deletes everything, with no uploader involvement');
select ok((select h.state='deleted' and u.status='rejected' and s.lifecycle='purged' and sp.status='deleted'
  and e.status='shredded' and e.contact_ciphertext is null
 from public.other_adult_held_uploads h join public.upload_sessions u on u.id=h.upload_session_id
 join public.subjects s on s.id=h.subject_id join public.subject_principals sp on sp.id=h.confirmation_principal_id
 join public.encrypted_contact_references e on e.principal_id=sp.id
 where h.id=pg_temp.fxv('delete','revision')::uuid),
 'the file ends, the subject is purged, and the person''s principal and contact are removed');
select is((select count(*) from public.subject_consents where subject_id=pg_temp.sid('delete') and revoked_at is null),0::bigint,
 'the uploader''s store consent for them is revoked');
select throws_ok($$select pg_temp.issue(pg_temp.sid('delete'),repeat('d',64))$$,'42501','not_found',
 'after deletion the uploader can never upload for them again');

-- 15. Expiry and the uploader's account deletion ----------------------------------------
select is((select h->>'status' from (select pg_temp.hold('expire',pg_temp.sid('expire'),repeat('d',64)) h) x),'stored_quarantined',
 '(expire) held');
select is((select h->>'status' from (select pg_temp.hold('withdraw',pg_temp.sid('withdraw'),repeat('f',64)) h) x),'stored_quarantined',
 '(withdraw) held');
select lives_ok($$select public.expire_due_other_adult_held_uploads_v1()$$,'the sweep runs');
select is((select count(*) from public.other_adult_held_uploads where state='pending'
 and id in (pg_temp.fxv('expire','revision')::uuid,pg_temp.fxv('withdraw','revision')::uuid)),2::bigint,
 'nothing of this suite is due before its deadline');
update public.other_adult_held_uploads set held_at=now()-interval '31 days',
 fixed_deadline=now()-interval '1 day' where id=pg_temp.fxv('expire','revision')::uuid;
select lives_ok($$select public.expire_due_other_adult_held_uploads_v1()$$,'the sweep runs again');
select ok((select h.state='expired' and u.status='rejected' from public.other_adult_held_uploads h
 join public.upload_sessions u on u.id=h.upload_session_id where h.id=pg_temp.fxv('expire','revision')::uuid),
 'a pending revision past its fixed deadline is rejected for purge');
select is((select status||':'||terminal_outcome_code from public.retention_due_phases
 where retention_id='adult.unconfirmed-30d' and target_id=pg_temp.fxv('expire','upload')::uuid),
 'succeeded:adult_unconfirmed_source_expired','adult.unconfirmed-30d completes as expired');
select ok((select state='pending' from public.other_adult_held_uploads where id=pg_temp.fxv('withdraw','revision')::uuid),
 'a revision inside its deadline is untouched by expiry');
-- A Path B draft whose request was never sent ends at its own deadline.
select pg_temp.draft('unsent','9');
update public.adult_subject_drafts set fixed_expires_at=clock_timestamp()-interval '1 second'
 where subject_id=pg_temp.sid('unsent');
select lives_ok($$select public.expire_due_other_adult_held_uploads_v1()$$,'the sweep runs for drafts');
select ok((select d.state='expired' and s.lifecycle='purged' and e.status='shredded' and e.contact_ciphertext is null
 from public.adult_subject_drafts d join public.subjects s on s.id=d.subject_id
 join public.subject_principals sp on sp.subject_id=s.id join public.encrypted_contact_references e on e.principal_id=sp.id
 where d.subject_id=pg_temp.sid('unsent')),'an unsent Path B draft expires and its contact is shredded');
update public.profiles set deletion_requested_at=clock_timestamp() where id='0a5e0000-0000-4000-8000-000000000001';
select lives_ok($$select public.expire_due_other_adult_held_uploads_v1()$$,'the sweep runs after the deletion request');
select ok((select state='withdrawn' from public.other_adult_held_uploads where id=pg_temp.fxv('withdraw','revision')::uuid)
 and (select state='withdrawn' from public.other_adult_held_uploads where id=pg_temp.fxv('main','revision')::uuid),
 'every pending or confirmed revision is withdrawn when the uploader deletes their account');
select is((select count(*) from public.upload_sessions where account_id='0a5e0000-0000-4000-8000-000000000001'
 and upload_authority_kind='other-adult-held' and status='held'),0::bigint,
 'no held session remains to block the uploader''s account purge');
update public.profiles set deletion_requested_at=null where id='0a5e0000-0000-4000-8000-000000000001';

-- 16. Path A still works as it did ---------------------------------------------------------
select is(pg_temp.open_session((select token_hash from fx where name='path-a'),'5','path-a-open-pppppppppppppppp'),1::bigint,
 'the Path A invitee opens their invitation');
select is(public.respond_adult_subject_invitation_session_v1(repeat('5',64),'confirm','path-a-accept-pppppppppppppp',
 '0a5e0000-0000-4000-8000-000000000002',repeat('4',64)),'accepted','Path A''s account acceptance is unchanged');
select ok((select subject_account_id='0a5e0000-0000-4000-8000-000000000002' and owner_account_id is null
 from public.subjects where id=pg_temp.sid('path-a')),'the accepted Path A subject belongs to the invitee alone');
select is((select count(*) from public.adult_subject_drafts where subject_id=pg_temp.sid('path-a')),0::bigint,
 'and its draft is consumed, as before');

-- 17. The contact keyring and the invitation attempt quota ---------------------------------
-- (20260928130000_hmac_keyring, 20260928130100_invitation_keyring_quota_doors)
-- Synthetic digests stand in for the application's keyed contact digests.
-- Every bare-digest call of this suite is above: after the rotation below a
-- bare digest is refused, which is itself one of the checks.
create function pg_temp.kd(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('path-b-keyring:'||p,'sha256'),'hex') $$;
create function pg_temp.keyed_draft(p_name text,p_hmac text,p_set jsonb) returns jsonb language plpgsql as $$
declare r jsonb;
begin
 r:=public.create_path_b_adult_draft_v1('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',
  'Synthetic Relative',date '1980-05-05',decode('00112233445566778899aabbccddeeff','hex'),p_hmac,
  pg_temp.kd('request:'||p_name),true,p_contact_hmac_set=>p_set);
 insert into fx(name,subject_id) values(p_name,(r->>'subjectDraftId')::uuid) on conflict(name) do nothing;
 return r;
end;
$$;
create function pg_temp.keyed_invite(p_subject uuid,p_hmac text,p_set jsonb,p_idem text,p_keys jsonb)
returns jsonb language sql as $$
 select public.create_path_b_invitation_v1('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',
  p_subject,p_hmac,pg_temp.kd('idem:'||p_idem),true,p_contact_hmac_set=>p_set,p_quota_keys=>p_keys);
$$;
create function pg_temp.pair(p text) returns jsonb language sql immutable as
 $$ select jsonb_build_object('1',pg_temp.kd(p||'1'),'2',pg_temp.kd(p||'2')) $$;
-- Nothing an exhausted or barred request could have written for a draft.
create function pg_temp.request_rows(p_subject uuid) returns bigint language sql as $$
 select (select count(*) from public.subject_invitations where target_kind='subject' and target_id=p_subject)
  +(select count(*) from public.mail_outbox m join public.subject_invitations i on i.id=m.target_id
    where i.target_id=p_subject)
  +(select count(*) from public.adult_subject_drafts where subject_id=p_subject and state<>'draft')
$$;

-- Y is reserved and signed before the rotation, under revision 1 alone.
select is((select r->>'state' from (select pg_temp.keyed_draft('key-y',pg_temp.kd('y1'),null) r) x),
 'awaiting_uploader_artifact','before any rotation a bare revision-1 digest still reserves a draft');
select pg_temp.present(pg_temp.sid('key-y'),'3');
select is((select s->>'recordKind' from (select pg_temp.sign(pg_temp.sid('key-y'),'3') s) x),'artifact_signature',
 '(key-y) the uploader signs');
select private.begin_hmac_key_rotation_v1('contact',2);

-- A bare digest, or a set missing a usable revision, is refused after it.
select throws_ok($$select pg_temp.keyed_draft('key-bare',pg_temp.kd('x1'),null)$$,'55000',
 'keyed digest set required','after a rotation a draft with a bare digest is refused');
select throws_ok($$select pg_temp.keyed_draft('key-short',null,jsonb_build_object('1',pg_temp.kd('x1')))$$,'55000',
 'keyed digest set incomplete','a draft whose set misses the active revision is refused');
select throws_ok($$select pg_temp.keyed_invite(pg_temp.sid('key-y'),pg_temp.kd('y1'),null,'y-bare',
 pg_temp.invitation_quota_keys())$$,'55000','keyed digest set required',
 'after a rotation a request with a bare digest is refused');
select throws_ok($$select pg_temp.keyed_invite(pg_temp.sid('key-y'),null,jsonb_build_object('1',pg_temp.kd('y1')),
 'y-short',pg_temp.invitation_quota_keys())$$,'55000','keyed digest set incomplete',
 'a request whose set misses a usable revision is refused');
select is(pg_temp.request_rows(pg_temp.sid('key-y')),0::bigint,'... and neither refusal wrote a request');

-- Z is reserved after the rotation: stored under the active revision and
-- indexed under every usable one.
select is((select r->>'state' from (select pg_temp.keyed_draft('key-z',null,pg_temp.pair('z')) r) x),
 'awaiting_uploader_artifact','a draft with the whole set is reserved');
select ok((select e.contact_hmac=pg_temp.kd('z2') and e.key_revision=2
 from public.encrypted_contact_references e join public.subject_principals sp on sp.id=e.principal_id
 where sp.subject_id=pg_temp.sid('key-z') and e.status='current'),
 'the contact is stored under the active revision''s digest and records revision 2');
select is((select jsonb_object_agg(h.hmac_key_revision::text,h.contact_hmac)
 from public.contact_hmac_indexes h join public.encrypted_contact_references e on e.id=h.contact_reference_id
 join public.subject_principals sp on sp.id=e.principal_id
 where sp.subject_id=pg_temp.sid('key-z') and h.status='current'),pg_temp.pair('z'),
 'the contact is indexed under both usable revisions, each with its own digest');
select is(private.declared_contact_aliases_v1(),'{}'::jsonb,'the declared set ends with the call');
select pg_temp.present(pg_temp.sid('key-z'),'4');
select pg_temp.sign(pg_temp.sid('key-z'),'4');
select is(pg_temp.keyed_invite(pg_temp.sid('key-z'),null,pg_temp.pair('z'),'z',pg_temp.invitation_quota_keys()),
 jsonb_build_object('status','received'),'(key-z) the request with the whole set is sent');
select ok((select i.status='pending' and i.email_hmac=pg_temp.kd('z2') and i.email_hmac_key_revision=2
  and m.state='queued' and m.template_payload=jsonb_build_object('request','esignature')
 from public.subject_invitations i join public.mail_outbox m on m.target_id=i.id
 where i.target_id=pg_temp.sid('key-z')),
 '... one pending invitation under revision 2, and its mail is queued');

-- A bar written under the rotated revision reaches a contact stored under
-- revision 1 only through the presented set.
insert into public.invitation_refusal_hmacs(email_hmac,refusal_revision,hmac_key_revision,created_at,expires_at)
 values(pg_temp.kd('y2'),1,2,clock_timestamp(),clock_timestamp()+interval '365 days');
select is(private.invitation_contact_barred_v1(pg_temp.kd('y1')),false,
 'one bare revision-1 digest would miss the bar written under revision 2');
select is(pg_temp.keyed_invite(pg_temp.sid('key-y'),null,pg_temp.pair('y'),'y',pg_temp.invitation_quota_keys()),
 jsonb_build_object('status','received'),'a request to a contact barred under the rotated revision returns the same receipt');
select is(pg_temp.request_rows(pg_temp.sid('key-y')),0::bigint,
 '... and is refused: no invitation, no mail, and the draft is still a draft');

-- The attempt quota is consumed first; an exhausted quota writes nothing else.
create temporary table quota_keys as select jsonb_build_object('1',jsonb_build_object(
 'authenticated-principal',pg_temp.kd('quota-account'),'source-network',pg_temp.kd('quota-network'))) k;
grant select on quota_keys to service_role;
select pg_temp.keyed_draft('key-q',null,pg_temp.pair('q'));
select pg_temp.present(pg_temp.sid('key-q'),'5');
select pg_temp.sign(pg_temp.sid('key-q'),'5');
select is(pg_temp.keyed_invite(pg_temp.sid('key-q'),null,pg_temp.pair('w'),'q-wrong',(select k from quota_keys)),
 jsonb_build_object('status','received'),'a request to an address the draft does not hold returns the receipt');
select is((select request_count from public.rate_limit_hmac_buckets
 where action_id='global-contact-refusal-bar-v1.invitation-attempt' and dimension='authenticated-principal'
  and window_seconds=3600 and bucket_key_hmac=pg_temp.kd('quota-account')),1,
 '... and still consumed one attempt: the quota comes before any address match');
select is((select count(*) filter (where private.consume_invitation_attempt_quota_v1(k)) from quota_keys,
 generate_series(1,9)),9::bigint,'nine more attempts reach the hourly ceiling of ten');
select is(pg_temp.keyed_invite(pg_temp.sid('key-q'),null,pg_temp.pair('q'),'q',(select k from quota_keys)),
 jsonb_build_object('status','received'),'the eleventh attempt returns the same receipt');
select is(pg_temp.request_rows(pg_temp.sid('key-q')),0::bigint,
 '... and writes nothing: no invitation, no mail, and the draft is still a draft');
select is(pg_temp.keyed_invite(pg_temp.sid('key-q'),null,pg_temp.pair('q'),'q',pg_temp.invitation_quota_keys()),
 jsonb_build_object('status','received'),'the same request under a quota with room');
select is((select count(*) from public.subject_invitations where target_id=pg_temp.sid('key-q') and status='pending'),
 1::bigint,'... is sent, so the quota alone stopped the eleventh');
select throws_ok($$select pg_temp.keyed_invite(pg_temp.sid('key-z'),null,pg_temp.pair('z'),'z-nokeys',null)$$,
 '55000','rate limit keys required','a request without quota keys is refused');

-- Only the keyed definers are callable, and only by the service role.
select ok(not has_function_privilege('service_role',
  'private.create_path_b_adult_draft_core_v1(uuid,uuid,text,date,bytea,text,text,boolean)','execute')
 and not has_function_privilege('service_role',
  'private.create_path_b_invitation_core_v1(uuid,uuid,uuid,text,text,boolean)','execute')
 and has_function_privilege('service_role',
  'public.create_path_b_adult_draft_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb)','execute')
 and has_function_privilege('service_role',
  'public.create_path_b_invitation_v1(uuid,uuid,uuid,text,text,boolean,jsonb,jsonb)','execute'),
 'the unkeyed bodies are callable by no API role; the keyed doors by the service role');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('create_path_b_adult_draft_v1','create_path_b_invitation_v1')),2::bigint,
 'each Path B door has one signature, so no unkeyed overload remains');

-- 18. Privileges -----------------------------------------------------------------------------
select ok(not has_table_privilege('anon','public.other_adult_held_uploads','select')
 and not has_table_privilege('authenticated','public.other_adult_held_uploads','select')
 and not has_table_privilege('inherit_upload_only','public.other_adult_held_uploads','select')
 and not has_table_privilege('service_role','public.other_adult_held_uploads','insert')
 and not has_table_privilege('service_role','public.other_adult_held_uploads','update'),
 'no browser role can read the held table, and only its functions write it');
select is((select coalesce(string_agg(p.oid::regprocedure::text,', '),'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and (p.proname like '%other_adult%' or p.proname like '%path_b%'
  or p.proname like '%adult_upload%' or p.proname like '%subject_esignature%'
  or p.proname in ('subject_upload_store_authority_v1','current_hashed_artifact_v1','freeze_adult_subject_flow_v1'))
  and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')
   or has_function_privilege('inherit_upload_only',p.oid,'execute'))),'private.is_path_b_file_v1(uuid)',
 'only the exact owner-scoped boolean RLS helper is browser-executable among Path B functions');
select ok(has_function_privilege('authenticated','private.is_path_b_file_v1(uuid)','execute')
 and not has_function_privilege('anon','private.is_path_b_file_v1(uuid)','execute')
 and not has_function_privilege('inherit_upload_only','private.is_path_b_file_v1(uuid)','execute'),
 'the policy helper is available only to authenticated policy evaluation, never anonymous or upload credentials');
select is((select count(*) from public.purge_target_stores where store_name='public.other_adult_held_uploads'
 and target_id='upload-and-ingest-working-state'),1::bigint,'the held table is a registered purge store');
select ok((select h.store_order>u.store_order
  and h.store_order<all(select store_order from public.purge_target_stores
   where target_id='upload-and-ingest-working-state' and store_name like 'private.embryo_ingest_write_%')
 from public.purge_target_stores h,public.purge_target_stores u
 where h.target_id='upload-and-ingest-working-state' and h.store_name='public.other_adult_held_uploads'
  and u.target_id=h.target_id and u.store_name='public.upload_staging_objects'),
 'it sits after the upload stores and leaves the embryo write fence''s stores last');

select * from finish();
rollback;
