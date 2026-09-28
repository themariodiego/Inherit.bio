-- Another adult's genome under the register's Path B
-- (20260928150000_other_adult_held_upload.sql; G2.6 adult half, G5.3).
--
-- Proves, on synthetic rows only, that:
--   * consent.upload-other-adult v1 is seeded as approved; the person's own
--     draft artifact installs only under TEST-LOCAL, as the exact pinned text;
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
create temporary table esig_text as select
 $artifact$What this is:

Someone who has a file of your DNA wants to add it to Inherit. They asked us to get your permission first. You can sign here without an Inherit account.

We cannot check that the person accepting this invitation is the person whose DNA this is.

What happens if you sign:

The person who asked can then add a DNA file for you. Each time they add one, we email you. Nothing is made from that file until you say yes to it. If you say no, or do not answer within 30 days, we delete it.

What they can see:

Signing shows them no result about you. We show you what they can see about you. It never includes your results unless you choose to share them, one purpose at a time.

What you can do later:

You can say no to any file, or delete everything we hold about you, at any time. You do not need an account, and the person who asked does not need to agree.

What you confirm:

1. I know that the person who asked has a file of my DNA and wants to add it to Inherit.

2. I agree that they may add it, and I understand that I will be asked about each file before anything is made from it.

3. I understand that Inherit will show me what they can see about me.

4. I understand that I can withdraw at any time, without an account, and that Inherit then deletes what it holds about me.

How you sign:

You sign by ticking each statement, choosing the country where you live, and typing your full legal name. Inherit stamps the date.$artifact$::text as body,
 $summary$Someone has a file of your DNA and wants to add it to Inherit. If you sign, they can add it. Nothing is made from a file until you say yes to that file. You can say no, or delete everything, at any time. You do not need an account.$summary$::text as summary;
grant select on esig_text to service_role;

select ok((select count(*)=1 and bool_and(effective_on=date '2026-09-28' and superseded_at is null
  and body_sha256=encode(extensions.digest(convert_to(body_markdown,'UTF8'),'sha256'),'hex'))
 from public.consent_artifacts where artifact_key='consent.upload-other-adult'),
 'consent.upload-other-adult v1 is seeded, approved and hash-verified');
select is((select count(*) from public.consent_artifacts where artifact_key='consent.subject-adult-esignature'),0::bigint,
 'no migration seeds the person''s unapproved draft artifact');
select throws_ok($$select public.install_test_local_subject_esignature_artifact_v1(
 (select body from esig_text),(select summary from esig_text),date '2026-09-28',false)$$,
 '42501','not_found','the draft installs only under TEST-LOCAL');
select throws_ok($$select public.install_test_local_subject_esignature_artifact_v1(
 (select body from esig_text)||' ',(select summary from esig_text),date '2026-09-28',true)$$,
 '22023','invalid_request','the installer accepts only the exact pinned body');
select throws_ok($$select public.install_test_local_subject_esignature_artifact_v1(
 (select body from esig_text),(select summary from esig_text)||' ',date '2026-09-28',true)$$,
 '22023','invalid_request','the installer accepts only the exact pinned summary');
select is(public.install_test_local_subject_esignature_artifact_v1(
 (select body from esig_text),(select summary from esig_text),date '2026-09-28',true),true,
 'under TEST-LOCAL the exact draft installs');
select is(public.install_test_local_subject_esignature_artifact_v1(
 (select body from esig_text),(select summary from esig_text),date '2026-09-28',true),true,
 'a second install is a no-op on the identical row');

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
 'held-until-accepted','no-uploader-access'],p_flag boolean default true) returns jsonb language sql as $$
 select public.sign_other_adult_upload_artifact_v1('0a5e0000-0000-4000-8000-000000000001',
  '0a5e0000-0000-4000-8000-000000000011',p_subject,1,
  (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-other-adult' and version=1),
  p_keys,decode(repeat('ab',24),'hex'),repeat(p_nonce,64),p_flag);
$$;
create function pg_temp.invite(p_subject uuid,p_hmac text,p_idem text,p_flag boolean default true) returns jsonb language sql as $$
 select public.create_path_b_invitation_v1('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',
  p_subject,p_hmac,p_idem,p_flag);
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
 decode('00112233445566778899aabbccddeeff','hex'),repeat('4',64),repeat('4',64),true);
grant select on path_a to service_role;
insert into fx(name,subject_id,token_hash) select 'path-a',subject_id,pg_temp.claim_for(invitation_id) from path_a;

-- 4. The uploader's signature ----------------------------------------------------
select throws_ok($$select pg_temp.present(pg_temp.sid('main'),'7',false)$$,'42501','not_found',
 'the artifact is presented only under TEST-LOCAL');
select throws_ok($$select pg_temp.present(pg_temp.sid('main'),'7',true,'0a5e0000-0000-4000-8000-000000000009',
 '0a5e0000-0000-4000-8000-000000000019')$$,'42501','not_found','another account cannot sign for this draft');
select throws_ok($$select pg_temp.present(pg_temp.sid('path-a'),'7')$$,'42501','not_found',
 'a Path A invitation is never something the inviter can sign an upload for');
select is((select p->>'artifactKey' from (select pg_temp.present(pg_temp.sid('main'),'7') p) x),'consent.upload-other-adult',
 'the uploader is presented the approved artifact');
select throws_ok($$select pg_temp.sign(pg_temp.sid('main'),'7',array['subject-alive-and-adult'])$$,'22023','invalid_request',
 'every published statement must be affirmed, one by one');
select throws_ok($$select pg_temp.sign(pg_temp.sid('main'),'8')$$,'42501','not_found',
 'a signature needs a nonce the server presented');
-- Before signing, the request goes nowhere.
select is(pg_temp.invite(pg_temp.sid('main'),repeat('a',64),repeat('a1',32)),jsonb_build_object('status','received'),
 'the request before the uploader signs returns the same receipt');
select is((select count(*) from public.subject_invitations where target_id=pg_temp.sid('main')),0::bigint,
 '... and creates no invitation');
select is((select s->>'recordKind' from (select pg_temp.sign(pg_temp.sid('main'),'7') s) x),'artifact_signature',
 'the uploader signs consent.upload-other-adult for this exact draft');
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
 where a.artifact_key='consent.upload-other-adult' and a.version=1 and s.id=p_subject
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
-- Only the lifecycle functions name the held table, and none of them is a reader.
select is((select string_agg(n.nspname||'.'||p.proname,', ' order by n.nspname,p.proname)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prosrc like '%other_adult_held_uploads%'),
 'private.adult_upload_mail_current_v1, private.adult_upload_revision_session_v1, private.begin_own_upload_finalization_v2, private.complete_own_upload_finalization_v1, private.delete_path_b_subject_v1, private.end_other_adult_held_upload_v1, private.issue_other_adult_held_upload_v1, private.other_adult_upload_targets_v1, private.own_upload_finalization_v1, public.activate_rights_session_v1, public.expire_due_other_adult_held_uploads_v1, public.respond_adult_upload_revision_v1','the held table is named only by the lifecycle functions');
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
select is(public.authorize_mail_submission_v1((select outbox_id from notice),
 (select attempt_count from public.mail_outbox where id=(select outbox_id from notice))),true,
 'the notice may be submitted while its revision is pending');
select is(pg_temp.open_session((select token_hash from notice),'1','notice-open-kkkkkkkkkkkkkkkk'),1::bigint,
 'the notice link opens a rights session without an account');
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

-- 17. Privileges -----------------------------------------------------------------------------
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
   or has_function_privilege('inherit_upload_only',p.oid,'execute'))),'',
 'no browser or upload role can execute any Path B function');
select is((select count(*) from public.purge_target_stores where store_name='public.other_adult_held_uploads'
 and target_id='upload-and-ingest-working-state'),1::bigint,'the held table is a registered purge store');

select * from finish();
rollback;
