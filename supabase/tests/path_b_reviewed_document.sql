-- The reviewed-document branch of Path B
-- (20261016190000_path_b_reviewed_document.sql; owner decision 2026-10-16,
-- "The subjects endpoints (G2.1)").
--
-- Proves, on synthetic rows only, that:
--   * the reviewed-document draft stores its flow, mode and evidence kind
--     once, and the uploader signs the same consent.upload-other-adult for it;
--   * the permission document session needs that signature, one page nonce
--     and the live originating session, and reuses the sealed evidence state
--     machine; a scan bound to the bytes clears the document;
--   * only the assigned, MFA-stepped-up named reviewer who read every chunk
--     can decide; nothing approves automatically; the uploader can never be
--     the reviewer; rejection ends only its draft and erases the key;
--   * api.subjects requires the exact approved document and review, spends
--     its nonce once, and answers the same receipt and leaves the same draft
--     state for an eligible and a barred contact, creating a request only for
--     the eligible one;
--   * recipient activation rechecks the basis and only then opens held
--     uploads; the document's post-acceptance deadline is fixed once;
--   * expiry, disposal and account deletion behave as the retention classes say.
-- Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc

update public.mail_outbox set state='invalidated' where state in ('queued','claimed');
insert into private.upload_authorization_config(singleton,auth_issuer)
 values(true,'http://127.0.0.1:54321/auth/v1')
 on conflict(singleton) do update set auth_issuer=excluded.auth_issuer;
update private.upload_authorization_config set maximum_array_bytes=52428800,maximum_vcf_bytes=52428800,
 maximum_account_bytes=1073741824,maximum_active_uploads=32 where singleton;

insert into auth.users(id,email,raw_user_meta_data) values
 ('0b5e0000-0000-4000-8000-000000000001','reviewed-uploader@e2e.local','{"display_name":"Synthetic uploader"}'),
 ('0b5e0000-0000-4000-8000-000000000003','reviewed-reviewer@e2e.local','{"display_name":"Synthetic reviewer"}'),
 ('0b5e0000-0000-4000-8000-000000000004','reviewed-second@e2e.local','{"display_name":"Synthetic second reviewer"}'),
 ('0b5e0000-0000-4000-8000-000000000009','reviewed-outsider@e2e.local','{"display_name":"Synthetic outsider"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('0b5e0000-0000-4000-8000-000000000011','0b5e0000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('0b5e0000-0000-4000-8000-000000000013','0b5e0000-0000-4000-8000-000000000003',now(),now(),'aal2'),
 ('0b5e0000-0000-4000-8000-000000000014','0b5e0000-0000-4000-8000-000000000004',now(),now(),'aal2'),
 ('0b5e0000-0000-4000-8000-000000000019','0b5e0000-0000-4000-8000-000000000009',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id in ('0b5e0000-0000-4000-8000-000000000001',
 '0b5e0000-0000-4000-8000-000000000009');
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'0b5e0000-0000-4000-8000-000000000001','0b5e0000-0000-4000-8000-000000000011',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['1','2']) letter;
select public.sign_own_upload_artifact_v1('0b5e0000-0000-4000-8000-000000000001','0b5e0000-0000-4000-8000-000000000011',
 (select id from public.subjects where subject_account_id='0b5e0000-0000-4000-8000-000000000001' and subject_class='self'),
 'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('1',64));
select public.sign_own_upload_artifact_v1('0b5e0000-0000-4000-8000-000000000001','0b5e0000-0000-4000-8000-000000000011',
 (select id from public.subjects where subject_account_id='0b5e0000-0000-4000-8000-000000000001' and subject_class='self'),
 'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('2',64));
select private.grant_claim_reviewer_v1('0b5e0000-0000-4000-8000-000000000003');
select private.grant_claim_reviewer_v1('0b5e0000-0000-4000-8000-000000000004');

-- Helpers ------------------------------------------------------------------------
create temporary table fx(name text primary key, subject_id uuid, session_id uuid, document_id uuid, review_id uuid,
 token_hash text);
grant all on fx to service_role;
create function pg_temp.sid(p_name text) returns uuid language sql as $$ select subject_id from fx where name=p_name $$;
create function pg_temp.fx_doc(p_name text) returns uuid language sql as $$ select document_id from fx where name=p_name $$;
create function pg_temp.draft(p_name text,p_letter text,p_dob date default date '1980-05-05',p_flag boolean default true)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
 r:=public.create_path_b_reviewed_document_draft_v1('0b5e0000-0000-4000-8000-000000000001',
  '0b5e0000-0000-4000-8000-000000000011','Synthetic Relative',p_dob,decode('00112233445566778899aabbccddeeff','hex'),
  repeat(p_letter,64),repeat(p_letter,64),p_flag);
 insert into fx(name,subject_id) values(p_name,(r->>'subjectDraftId')::uuid) on conflict(name) do nothing;
 return r;
end $$;
create function pg_temp.sign(p_subject uuid,p_nonce text) returns jsonb language plpgsql as $$
begin
 perform public.present_other_adult_upload_artifact_v1('0b5e0000-0000-4000-8000-000000000001',
  '0b5e0000-0000-4000-8000-000000000011',p_subject,repeat(p_nonce,64),clock_timestamp()+interval '9 minutes',true);
 return public.sign_other_adult_upload_artifact_v1('0b5e0000-0000-4000-8000-000000000001',
  '0b5e0000-0000-4000-8000-000000000011',p_subject,2,
  (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-other-adult' and version=2),
  array['subject-alive-and-adult','subject-permission-held','lawfully-held-with-knowledge','contact-belongs-to-subject',
   'no-excluded-relationship','held-until-accepted','no-uploader-access'],decode(repeat('ab',24),'hex'),repeat(p_nonce,64),true);
end $$;
create function pg_temp.open(p_subject uuid,p_letter text,p_size integer default 5,
 p_account uuid default '0b5e0000-0000-4000-8000-000000000001',p_session uuid default '0b5e0000-0000-4000-8000-000000000011',
 p_flag boolean default true) returns jsonb language sql as $$
 select public.open_permission_document_session_v1(p_account,p_session,p_subject,'application/pdf',p_size,
  encode(extensions.digest('document:'||p_letter,'sha256'),'hex'),encode(extensions.digest('cookie:'||p_letter,'sha256'),'hex'),
  extensions.gen_random_bytes(72),encode(extensions.digest('nonce:'||p_letter,'sha256'),'hex'),p_flag);
$$;
create function pg_temp.cookie(p_letter text) returns text language sql as $$
 select encode(extensions.digest('cookie:'||p_letter,'sha256'),'hex') $$;
-- The transport for one session: one chunk, the completion and a clean scan.
create function pg_temp.upload(p_name text,p_letter text,p_scan text default 'OK') returns jsonb language plpgsql as $$
declare v_session uuid:=(select session_id from fx where name=p_name); r jsonb; b jsonb; f jsonb; lease text; job jsonb;
begin
 r:=public.reserve_claim_document_chunk_v1(v_session,pg_temp.cookie(p_letter),0,5,
  encode(extensions.digest('chunk:'||p_letter,'sha256'),'hex'));
 perform public.settle_claim_document_chunk_v1(v_session,pg_temp.cookie(p_letter),0,true);
 b:=public.begin_claim_document_completion_v1(v_session,pg_temp.cookie(p_letter),
  encode(extensions.digest('complete:'||p_letter,'sha256'),'hex'),1);
 f:=public.finish_claim_document_completion_v1(v_session,pg_temp.cookie(p_letter),
  encode(extensions.digest('complete:'||p_letter,'sha256'),'hex'),'composed',b->>'objectKey');
 update fx set document_id=(f->>'documentId')::uuid where name=p_name;
 lease:=encode(extensions.digest('lease:'||p_letter,'sha256'),'hex');
 job:=public.claim_next_permission_document_scan_v1(lease);
 if (job->>'documentId')::uuid is distinct from (f->>'documentId')::uuid then raise exception 'scan claimed another document'; end if;
 perform public.record_permission_document_scan_v1((job->>'documentId')::uuid,lease,p_scan,job->>'sha256','test-double',1,clock_timestamp());
 return jsonb_build_object('reserve',r,'begin',b,'finish',f);
end $$;
create function pg_temp.jwt(p_account uuid,p_session uuid,p_aal text default 'aal2',p_mfa_age integer default 60)
returns void language sql volatile as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',p_account,'role','authenticated','aal',p_aal,
  'session_id',p_session,'iss',(select auth_issuer from private.upload_authorization_config where singleton),
  'aud','authenticated','exp',floor(extract(epoch from clock_timestamp()))+3600,
  'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp()))-p_mfa_age)))::text,true);
$$;
create function pg_temp.as_reviewer(p_sql text,p_account uuid default '0b5e0000-0000-4000-8000-000000000003',
 p_session uuid default '0b5e0000-0000-4000-8000-000000000013',p_aal text default 'aal2') returns jsonb
language plpgsql as $$
declare r jsonb;
begin
 perform pg_temp.jwt(p_account,p_session,p_aal);
 perform set_config('role','authenticated',true);
 begin
  execute p_sql into r;
 exception when others then
  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','',true);
  raise;
 end;
 perform set_config('role','postgres',true); perform set_config('request.jwt.claims','',true);
 return r;
end $$;
grant execute on function pg_temp.as_reviewer(text,uuid,uuid,text) to authenticated;
create function pg_temp.read_all(p_document uuid,p_cookie text) returns jsonb language plpgsql as $$
declare d jsonb; n integer;
begin
 d:=pg_temp.as_reviewer(format('select public.open_claim_review_download_v1(%L::uuid,%L)',p_document,p_cookie));
 for n in 0..(d->>'chunkCount')::integer-1 loop
  perform pg_temp.as_reviewer(format('select public.authorize_claim_review_chunk_v1(%L::uuid,%L,%s)',d->>'session',p_cookie,n));
 end loop;
 return d;
end $$;
create function pg_temp.decide(p_document uuid,p_decision text,p_nonce text,p_revision bigint default 1) returns jsonb
language sql as $$
 select pg_temp.as_reviewer(format('select public.decide_permission_document_v1(%L::uuid,%L,%s,%L,%L,%L::bytea)',
  p_document,(select sha256 from private.permission_documents where id=p_document),p_revision,p_decision,
  encode(extensions.digest('decision:'||p_nonce,'sha256'),'hex'),'\x'||repeat('cd',48)));
$$;
create function pg_temp.finalize(p_name text,p_letter text,p_nonce text,p_review uuid default null) returns jsonb
language sql as $$
 select public.finalize_path_b_reviewed_document_v1('0b5e0000-0000-4000-8000-000000000001',
  '0b5e0000-0000-4000-8000-000000000011',pg_temp.sid(p_name),pg_temp.fx_doc(p_name),
  coalesce(p_review,(select review_id from fx where name=p_name)),encode(extensions.digest('finalize:'||p_nonce,'sha256'),'hex'),
  encode(extensions.digest('idem:'||p_nonce,'sha256'),'hex'),true,jsonb_build_object('1',repeat(p_letter,64)),
  pg_temp.invitation_quota_keys());
$$;
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
end $$;
create function pg_temp.invitation_of(p_subject uuid) returns uuid language sql as $$
 select id from public.subject_invitations where target_kind='subject' and target_id=p_subject
  and invitation_kind='adult_subject' order by created_at desc limit 1 $$;
create function pg_temp.person_signs(p_session text,p_nonce text) returns text language sql as $$
 select public.confirm_path_b_subject_v1(repeat(p_session,64),p_nonce,1,
  (select body_sha256 from public.consent_artifacts where artifact_key='consent.subject-adult-esignature' and version=1),
  array['knows-uploader-has-file','agrees-to-upload','shown-what-uploader-sees','may-withdraw-any-time'],
  decode(repeat('cd',24),'hex'),'GB',true);
$$;
create function pg_temp.issue(p_subject uuid) returns jsonb language sql as $$
 select public.issue_other_adult_held_upload_v1('0b5e0000-0000-4000-8000-000000000001',
  '0b5e0000-0000-4000-8000-000000000011',p_subject,'VCF',8,repeat('e',64),true);
$$;
-- One draft through signature, document, scan and approval.
create function pg_temp.approved(p_name text,p_letter text) returns uuid language plpgsql as $$
begin
 perform pg_temp.draft(p_name,p_letter);
 perform pg_temp.sign(pg_temp.sid(p_name),p_letter);
 update fx set session_id=(pg_temp.open(pg_temp.sid(p_name),p_letter)->>'session')::uuid where name=p_name;
 perform pg_temp.upload(p_name,p_letter);
 perform private.assign_permission_document_review_v1(pg_temp.fx_doc(p_name),'0b5e0000-0000-4000-8000-000000000003');
 perform pg_temp.read_all(pg_temp.fx_doc(p_name),encode(extensions.digest('review:'||p_letter,'sha256'),'hex'));
 if pg_temp.decide(pg_temp.fx_doc(p_name),'approved',p_letter)->>'decision'<>'approved' then
  raise exception 'approval failed for %',p_name; end if;
 update fx set review_id=(select r.id from private.permission_document_reviews r where r.document_id=pg_temp.fx_doc(p_name))
  where name=p_name;
 return pg_temp.sid(p_name);
end $$;

-- 1. The draft -----------------------------------------------------------------------
select ok((select public=false and file_size_limit=20000028 and allowed_mime_types=array['application/octet-stream']
 from storage.buckets where id='legal-evidence'),'the legal-evidence bucket exists, private and octet-stream only');
select is((select count(*) from pg_policies where schemaname='storage' and tablename='objects'
 and (qual like '%legal-evidence%' or with_check like '%legal-evidence%')),0::bigint,
 'no client Storage policy touches the legal-evidence bucket');
select throws_ok($$select pg_temp.draft('x-flag','e',p_flag=>false)$$,'42501','not_found',
 'a reviewed-document draft is reserved only under TEST-LOCAL');
select throws_ok($$select pg_temp.draft('x-minor','e',(timezone('UTC',clock_timestamp())::date-interval '18 years'+interval '1 day')::date)$$,
 '22023','subject_not_adult','the server refuses a date of birth under 18');
select is((select r->>'state' from (select pg_temp.draft('main','a') r) x),'awaiting_uploader_artifact',
 'the uploader reserves a reviewed-document draft; the next step is their own signature');
select is((select r->>'subjectDraftId' from (select public.create_path_b_reviewed_document_draft_v1(
  '0b5e0000-0000-4000-8000-000000000001','0b5e0000-0000-4000-8000-000000000011','Synthetic Relative',date '1980-05-05',
  decode('00112233445566778899aabbccddeeff','hex'),repeat('a',64),repeat('a',64),true) r) x),pg_temp.sid('main')::text,
 'the same request reserves the same draft once');
-- G5.6 (20261023130000): the draft names the uploader only through the
-- door that records the page's one-time nonce. The actor is cleared where
-- production would have committed; no user JWT is present.
savepoint attributed_draft;
select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('inherit.legal_audit_actor','',true);
select public.create_path_b_reviewed_document_draft_v1('0b5e0000-0000-4000-8000-000000000001','0b5e0000-0000-4000-8000-000000000011','Synthetic Attributed',date '1980-05-05',
  decode('00112233445566778899aabbccddeeff','hex'),repeat('7',64),repeat('7',64),true);
select is((select audit_principal_id from public.legal_audit_log where event_code='subject-draft.created' and route_id='api.subject-drafts' order by seq desc limit 1),null::uuid,
 'the draft writer alone, with no nonce, names no one');
select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('inherit.legal_audit_actor','',true);
select lives_ok($$select public.create_path_b_reviewed_document_draft_with_nonce_v1('0b5e0000-0000-4000-8000-000000000001','0b5e0000-0000-4000-8000-000000000011','Synthetic Attributed',date '1980-05-05',
  decode('00112233445566778899aabbccddeeff','hex'),repeat('8',64),repeat('8',64),true,null,
  encode(extensions.digest('reviewed-draft-nonce-one','sha256'),'hex'),clock_timestamp()+interval '5 minutes')$$,'the door reserves a draft');
select ok(coalesce((select audit_principal_id from public.legal_audit_log where event_code='subject-draft.created' and route_id='api.subject-drafts' order by seq desc limit 1)
  =(select audit_principal_id from private.legal_audit_account_principals where account_id='0b5e0000-0000-4000-8000-000000000001'::uuid),false),'and its event names the uploader');
select throws_ok($$select public.create_path_b_reviewed_document_draft_with_nonce_v1('0b5e0000-0000-4000-8000-000000000001','0b5e0000-0000-4000-8000-000000000011','Synthetic Attributed',date '1980-05-05',
  decode('00112233445566778899aabbccddeeff','hex'),repeat('9',64),repeat('9',64),true,null,
  encode(extensions.digest('reviewed-draft-nonce-one','sha256'),'hex'),clock_timestamp()+interval '5 minutes')$$,
 '22023','invalid_operation_nonce','a replayed nonce is refused');
rollback to attributed_draft;
select is((select count(*) from public.subjects where display_label='Synthetic Attributed'),0::bigint,
 'the attribution drafts were undone with their savepoint');
select ok((select d.adult_flow='path-b-reviewed-document' and d.confirmation_mode='path-b-token-or-account'
  and d.evidence_kind='uploaded_document' and d.state='draft' and s.lifecycle='draft' and s.subject_class='other_adult'
  and s.subject_account_id is null and s.owner_account_id='0b5e0000-0000-4000-8000-000000000001'
 from public.adult_subject_drafts d join public.subjects s on s.id=d.subject_id where d.subject_id=pg_temp.sid('main')),
 'the draft stores path-b-reviewed-document with path-b-token-or-account and uploaded_document');
select throws_ok($$update public.adult_subject_drafts set adult_flow='path-b-subject-esignature',evidence_kind='esignature'
 where subject_id=pg_temp.sid('main')$$,'55000','immutable_adult_flow','the flow never changes after the draft is reserved');
select throws_ok($$insert into public.adult_subject_drafts(owner_account_id,subject_id,draft_revision,state,fixed_expires_at,
 adult_flow,confirmation_mode,evidence_kind,request_key) values('0b5e0000-0000-4000-8000-000000000009',
 (select id from public.subjects where subject_account_id='0b5e0000-0000-4000-8000-000000000009' and subject_class='self'),
 1,'draft',clock_timestamp()+interval '1 day','path-b-reviewed-document','path-b-token-or-account','esignature',repeat('9',64))$$,
 '23514',null,'a reviewed-document draft can carry no other evidence kind');

-- 2. The document session --------------------------------------------------------------
select throws_ok($$select pg_temp.open(pg_temp.sid('main'),'a')$$,'42501','not_found',
 'without the uploader''s signature for this draft there is no document session');
select is((select (s->>'recordKind') from (select pg_temp.sign(pg_temp.sid('main'),'a') s) x),'artifact_signature',
 'the uploader signs consent.upload-other-adult for the reviewed-document draft');
select throws_ok($$select pg_temp.open(pg_temp.sid('main'),'a',p_flag=>false)$$,'42501','not_found',
 'the document session opens only under TEST-LOCAL');
select throws_ok($$select pg_temp.open(pg_temp.sid('main'),'a',5,'0b5e0000-0000-4000-8000-000000000009',
 '0b5e0000-0000-4000-8000-000000000019')$$,'42501','not_found','another account cannot open a session for this draft');
select throws_ok($$select pg_temp.open(pg_temp.sid('main'),'a',20000001)$$,'22023','invalid_request',
 'a document over the registered maximum is refused');
create temporary table main_session as select pg_temp.open(pg_temp.sid('main'),'a') as value;
update fx set session_id=(select (value->>'session')::uuid from main_session) where name='main';
select is((select value->>'status'||':'||(value->>'documentKind') from main_session),'open:adult-signed-permission',
 'the session opens for the one document kind');
select ok((select s.expires_at<=s.created_at+interval '24 hours' and s.cookie_hash=pg_temp.cookie('a')
  and s.auth_session_id='0b5e0000-0000-4000-8000-000000000011' and s.wrapped_document_key is not null
  and s.uploader_consent_id is not null and not (to_jsonb(s) ? 'bucket')
 from private.permission_document_sessions s where s.id=(select session_id from fx where name='main')),
 'one hash-only cookie, the originating session, the uploader''s signature and a 24-hour hard expiry');
select throws_ok($$select pg_temp.open(pg_temp.sid('main'),'a')$$,'23505',null,
 'the page''s operation nonce opens one session only');
-- The originating session is rechecked at every chunk.
savepoint revision_case;
update public.profiles set auth_session_revision=auth_session_revision+1 where id='0b5e0000-0000-4000-8000-000000000001';
select throws_ok($$select public.reserve_claim_document_chunk_v1((select session_id from fx where name='main'),
 pg_temp.cookie('a'),0,5,repeat('5',64))$$,'42501',null,'a stale account session revision stops the next chunk');
rollback to revision_case;
select throws_ok($$select public.reserve_claim_document_chunk_v1((select session_id from fx where name='main'),
 pg_temp.cookie('z'),0,5,repeat('5',64))$$,'42501',null,'another cookie cannot write a chunk');
create temporary table main_upload as select pg_temp.upload('main','a') as value;
select is((select value#>>'{reserve,storageKind}' from main_upload),'permission','the chunk door names the permission store');
select ok((select (value#>>'{reserve,objectKey}') like pg_temp.sid('main')::text||'/%' from main_upload),
 'the database generates the object key under the draft');
select is((select value#>>'{finish,status}' from main_upload),'scanning','a composed document waits for its scan');
select ok((select d.state='clean' and d.review_state='pending' and d.review_revision=1 and d.scanned_sha256=d.sha256
 from private.permission_documents d where d.id=pg_temp.fx_doc('main')),'the scan bound to the exact bytes clears it');
select is(public.begin_claim_document_completion_v1((select session_id from fx where name='main'),pg_temp.cookie('a'),
 encode(extensions.digest('complete:a','sha256'),'hex'),1)->>'status','review_pending',
 'the same completion nonce reads review_pending, with no reviewer named');
select throws_ok($$update private.permission_documents set review_state='approved' where id=pg_temp.fx_doc('main')$$,
 '42501','only a recorded human decision changes a review','no automated approval: a direct write is refused');

-- 3. Named-human review --------------------------------------------------------------------
select throws_ok($$select pg_temp.as_reviewer(format('select to_jsonb(public.review_document_domain_v1(%L::uuid))',
 pg_temp.fx_doc('main')))$$,'42501',null,'an unassigned reviewer cannot see the document');
select private.grant_claim_reviewer_v1('0b5e0000-0000-4000-8000-000000000001');
select throws_ok($$select private.assign_permission_document_review_v1(pg_temp.fx_doc('main'),'0b5e0000-0000-4000-8000-000000000001')$$,
 '42501','permission document reviewer unavailable','the uploader is never the reviewer of their own draft');
select private.revoke_claim_reviewer_v1('0b5e0000-0000-4000-8000-000000000001');
select is(private.assign_permission_document_review_v1(pg_temp.fx_doc('main'),'0b5e0000-0000-4000-8000-000000000003'),1::bigint,
 'the database owner assigns one named reviewer');
select is(pg_temp.as_reviewer(format('select to_jsonb(public.review_document_domain_v1(%L::uuid))',pg_temp.fx_doc('main'))),
 to_jsonb('permission'::text),'the assigned reviewer sees a permission document');
select throws_ok($$select pg_temp.as_reviewer(format('select public.open_claim_review_download_v1(%L::uuid,%L)',
 pg_temp.fx_doc('main'),repeat('7',64)),p_aal=>'aal1')$$,'42501',null,'no MFA step-up, no read');
select throws_ok($$select pg_temp.as_reviewer(format('select public.open_claim_review_download_v1(%L::uuid,%L)',
 pg_temp.fx_doc('main'),repeat('7',64)),'0b5e0000-0000-4000-8000-000000000004','0b5e0000-0000-4000-8000-000000000014')$$,
 '42501',null,'another named reviewer without the assignment cannot read');
select throws_ok($$select pg_temp.decide(pg_temp.fx_doc('main'),'approved','unread')$$,'42501',null,
 'a decision before every chunk was read is refused');
create temporary table main_download as select pg_temp.read_all(pg_temp.fx_doc('main'),repeat('8',64)) as value;
select is((select value->>'documentKind'||':'||(value->>'chunkCount')||':'||(value->>'reviewRevision') from main_download),
 'adult-signed-permission:1:1','the reviewer''s bounded session names the kind, chunk count and review revision');
select ok(exists(select 1 from public.legal_audit_log where event_code='legal-evidence.document.chunk.read'),
 'every chunk read is audited');
select throws_ok($$select pg_temp.decide(pg_temp.fx_doc('main'),'rejected-documentary-conflict','conflict')$$,'42501',null,
 'rejected-documentary-conflict has no contradiction-v1 producer yet and records nothing');
select throws_ok($$select pg_temp.decide(pg_temp.fx_doc('main'),'approved','stale',2)$$,'42501',null,
 'a stale review revision is refused');
create temporary table main_decision as select pg_temp.decide(pg_temp.fx_doc('main'),'approved','a') as value;
select is((select value from main_decision),jsonb_build_object('documentId',pg_temp.fx_doc('main'),'decision','approved',
 'reviewRevision',2),'the named reviewer approves; the review revision advances');
update fx set review_id=(select r.id from private.permission_document_reviews r where r.document_id=pg_temp.fx_doc('main'))
 where name='main';
select ok((select r.decision='approved' and r.reviewer_account_id='0b5e0000-0000-4000-8000-000000000003'
  and r.document_sha256=d.sha256 and r.review_revision=1 and d.review_state='approved' and d.review_revision=2
  and not exists(select 1 from private.permission_document_assignments a where a.document_id=d.id and a.status='current')
 from private.permission_document_reviews r join private.permission_documents d on d.id=r.document_id
 where d.id=pg_temp.fx_doc('main')),'one immutable decision bound to the exact hash; the assignment is closed');
select throws_ok($$select pg_temp.decide(pg_temp.fx_doc('main'),'approved','again',2)$$,'42501',null,'a document is decided once');
select throws_ok($$update private.permission_document_reviews set decision='rejected' where document_id=pg_temp.fx_doc('main')$$,
 '42501','review decision immutable','the decision row is immutable');
select ok((select d.state='draft' and s.lifecycle='draft' from public.adult_subject_drafts d join public.subjects s on s.id=d.subject_id
 where d.subject_id=pg_temp.sid('main')),'approval alone consumes nothing: the draft is still a draft');
select throws_ok($$select pg_temp.issue(pg_temp.sid('main'))$$,'42501','not_found','approval opens no upload');

-- 4. api.subjects ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.finalize('main','a','wrong-review',gen_random_uuid())$$,'42501','not_found',
 'a review that is not the current approval of this document is refused');
select throws_ok($$select public.finalize_path_b_reviewed_document_v1('0b5e0000-0000-4000-8000-000000000009',
 '0b5e0000-0000-4000-8000-000000000019',pg_temp.sid('main'),pg_temp.fx_doc('main'),(select review_id from fx where name='main'),
 repeat('6',64),repeat('6',64),true,jsonb_build_object('1',repeat('a',64)),pg_temp.invitation_quota_keys())$$,'42501','not_found',
 'another account cannot finalize this draft');
select throws_ok($$select public.finalize_path_b_reviewed_document_v1(
 '0b5e0000-0000-4000-8000-000000000001','0b5e0000-0000-4000-8000-000000000011',pg_temp.sid('main'),pg_temp.fx_doc('main'),
 (select review_id from fx where name='main'),repeat('6',64),repeat('6',64),false,jsonb_build_object('1',repeat('a',64)),
 pg_temp.invitation_quota_keys())$$,'42501','not_found','api.subjects is closed outside TEST-LOCAL');
select is(pg_temp.finalize('main','a','main'),jsonb_build_object('status','received','next','awaiting_subject_confirmation'),
 'an eligible contact gets subject-created-v1');
select ok((select d.state='invited' and i.status='pending' and i.invitation_kind='adult_subject'
  and m.template_id='adult-subject-invitation' and m.template_payload=jsonb_build_object('request','esignature')
  and r.document_id=pg_temp.fx_doc('main') and r.review_id=(select review_id from fx where name='main')
 from public.adult_subject_drafts d join public.subject_invitations i on i.target_id=d.subject_id
 join public.mail_outbox m on m.target_id=i.id join private.path_b_reviewed_document_requests r on r.invitation_id=i.id
 where d.subject_id=pg_temp.sid('main')),'one hidden request bound to the draft, document and review');
select throws_ok($$select pg_temp.finalize('main','a','main')$$,'42501','not_found','a requested draft is finalized once');

-- 20261023140000: a review download records its creation and expiry from
-- one clock reading. Planted: the creation default reads the clock a second
-- earlier than the body does, so a body that leaves created_at to the default
-- breaks the table's one-hour check every time; the reviewed body sets both.
savepoint review_clock;
alter table private.permission_document_review_downloads
 alter column created_at set default clock_timestamp()-interval '1 second';
-- The steps of pg_temp.approved up to the reviewer's read; the decision would
-- delete the download rows this block inspects.
select pg_temp.draft('clock','f');
select pg_temp.sign(pg_temp.sid('clock'),'f');
update fx set session_id=(pg_temp.open(pg_temp.sid('clock'),'f')->>'session')::uuid where name='clock';
select pg_temp.upload('clock','f');
select private.assign_permission_document_review_v1(pg_temp.fx_doc('clock'),'0b5e0000-0000-4000-8000-000000000003');
select lives_ok($$select pg_temp.read_all(pg_temp.fx_doc('clock'),encode(extensions.digest('review:f','sha256'),'hex'))$$,
 'planted: with the two clock reads a second apart, the named reviewer''s download still opens');
select ok((select count(*)=1 and bool_and(expires_at=created_at+interval '1 hour')
 from private.permission_document_review_downloads where document_id=pg_temp.fx_doc('clock')),
 'the review download expires exactly one hour after its own creation time');
rollback to review_clock;
select is((select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
 where d.adrelid='private.permission_document_review_downloads'::regclass and a.attname='created_at'),'clock_timestamp()',
 'the planted default was undone with its savepoint');
select is((select md5(pg_get_functiondef('public.open_permission_review_download_v1(uuid,text)'::regprocedure))),
 '5d13a237d73df132ac00a219ea289ebd','the review download open step is its reviewed successor');

-- The barred contact: the same receipt, the same visible draft state, no request.
select pg_temp.approved('barred','b');
insert into public.invitation_refusal_hmacs(email_hmac,refusal_revision,hmac_key_revision,created_at,expires_at)
 values(repeat('b',64),1,1,clock_timestamp(),clock_timestamp()+interval '365 days');
select is(pg_temp.finalize('barred','b','barred'),jsonb_build_object('status','received','next','awaiting_subject_confirmation'),
 'a barred contact gets the identical receipt');
select ok((select d.state='invited' from public.adult_subject_drafts d where d.subject_id=pg_temp.sid('barred')),
 '... and the draft reads the same as an eligible one');
select is((select count(*) from public.subject_invitations where target_id=pg_temp.sid('barred')),0::bigint,
 '... but no invitation, token or mail exists for it');
select is((select jsonb_agg(t->>'state' order by t->>'label') from jsonb_array_elements(public.path_b_reviewed_document_targets_v1(
 '0b5e0000-0000-4000-8000-000000000001','0b5e0000-0000-4000-8000-000000000011',true)) t
 where (t->>'subjectId')::uuid in (pg_temp.sid('main'),pg_temp.sid('barred'))),'["awaiting-signature", "awaiting-signature"]'::jsonb,
 'the uploader''s list cannot tell the barred request from the eligible one');

-- 5. Recipient activation --------------------------------------------------------------------
update fx set token_hash=pg_temp.claim_for(pg_temp.invitation_of(pg_temp.sid('main'))) where name='main';
select is((select count(*) from public.activate_rights_session_v1((select token_hash from fx where name='main'),
 repeat('a',64),'reviewed-open-aaaaaaaaaaaaaaaa')),1::bigint,'the person opens the request mail');
savepoint basis_case;
update private.permission_document_sessions set wrapped_document_key=null,document_key_shredded_at=clock_timestamp()
 where id=(select session_id from fx where name='main');
select is(pg_temp.person_signs('a','reviewed-sign-basis-aaaaaaaaaa'),'unavailable',
 'activation rechecks the document: a lost basis refuses it');
rollback to basis_case;
select is(pg_temp.person_signs('a','reviewed-sign-aaaaaaaaaaaaaaaa'),'accepted','the person signs their own Path B text');
set constraints all immediate;
set constraints all deferred;
select ok((select s.lifecycle='active' and s.subject_account_id is null and d.state='confirmed' and d.evidence_kind='uploaded_document'
 from public.subjects s join public.adult_subject_drafts d on d.subject_id=s.id where s.id=pg_temp.sid('main')),
 'the draft becomes the uploader-owned other_adult subject, evidence kind uploaded_document');
select ok((select doc.retain_until between clock_timestamp()+interval '729 days' and clock_timestamp()+interval '731 days'
  and ds.wrapped_document_key is not null
 from private.permission_documents doc join private.permission_document_sessions ds on ds.id=doc.session_id
 where doc.id=pg_temp.fx_doc('main')),'the document is kept, with its fixed 730-day post-acceptance deadline');
select ok((select (r->>'uploadId') is not null from (select pg_temp.issue(pg_temp.sid('main')) r) x),
 'only after activation may the uploader open a held upload');
select ok(exists(select 1 from jsonb_array_elements(private.other_adult_upload_targets_v1('0b5e0000-0000-4000-8000-000000000001',
 '0b5e0000-0000-4000-8000-000000000011',true)) t where (t->>'subjectId')::uuid=pg_temp.sid('main')),
 'the confirmed subject joins the uploader''s held-upload list');

-- 6. Rejection ends only its draft ------------------------------------------------------------
select pg_temp.draft('rejected','c');
select pg_temp.sign(pg_temp.sid('rejected'),'c');
update fx set session_id=(pg_temp.open(pg_temp.sid('rejected'),'c')->>'session')::uuid where name='rejected';
select pg_temp.upload('rejected','c');
select private.assign_permission_document_review_v1(pg_temp.fx_doc('rejected'),'0b5e0000-0000-4000-8000-000000000003');
select pg_temp.read_all(pg_temp.fx_doc('rejected'),repeat('9',64));
select is(pg_temp.decide(pg_temp.fx_doc('rejected'),'rejected','c')->>'decision','rejected','the reviewer rejects');
set constraints all immediate;
set constraints all deferred;
select ok((select d.state='cancelled' and s.lifecycle='purged' from public.adult_subject_drafts d join public.subjects s on s.id=d.subject_id
 where d.subject_id=pg_temp.sid('rejected')),'only the dependent draft ends');
select ok((select wrapped_document_key is null from private.permission_document_sessions where id=(select session_id from fx where name='rejected')),
 'the document key is erased in the same transaction');
select ok((select count(*)=2 from private.permission_document_objects_due_v1(100) k
 where k.object_key like pg_temp.sid('rejected')::text||'/%'),'its fragment and document objects are due for deletion');
select is(private.confirm_permission_document_objects_deleted_v1((select array_agg(k.object_key)
 from private.permission_document_objects_due_v1(100) k where k.object_key like pg_temp.sid('rejected')::text||'/%'),'jobs.retention'),
 2,'the retention job confirms both deleted');
select ok((select r.decision='rejected' and r.reason_ciphertext is null and r.reason_shredded_at is not null
  and not exists(select 1 from private.permission_documents d where d.id=r.document_id)
 from private.permission_document_reviews r where r.document_id=pg_temp.fx_doc('rejected')),
 'only the hash, kind and decision remain; the reviewer reason goes with the document');
select ok((select state='document-refused' from (select t->>'state' state from jsonb_array_elements(public.path_b_reviewed_document_targets_v1(
 '0b5e0000-0000-4000-8000-000000000001','0b5e0000-0000-4000-8000-000000000011',true)) t
 where (t->>'subjectId')::uuid=pg_temp.sid('rejected')) x),'the uploader sees that the document was refused');

-- 7. Scan refusal, expiry and account deletion -----------------------------------------------
select pg_temp.draft('infected','d');
select pg_temp.sign(pg_temp.sid('infected'),'d');
update fx set session_id=(pg_temp.open(pg_temp.sid('infected'),'d')->>'session')::uuid where name='infected';
select pg_temp.upload('infected','d','FOUND');
select is(public.begin_claim_document_completion_v1((select session_id from fx where name='infected'),pg_temp.cookie('d'),
 encode(extensions.digest('complete:d','sha256'),'hex'),1),jsonb_build_object('status','refused','reason','infected'),
 'an infected document is refused with a closed reason');
select ok((select wrapped_document_key is null from private.permission_document_sessions where id=(select session_id from fx where name='infected')),
 'and its key is erased at once');

select pg_temp.draft('expiring','e');
update public.adult_subject_drafts set fixed_expires_at=clock_timestamp()-interval '1 second' where subject_id=pg_temp.sid('expiring');
select ok(public.expire_due_path_b_reviewed_documents_v1()>=1,'the sweep ends an expired reviewed-document draft');
select ok((select d.state='expired' and s.lifecycle='purged' from public.adult_subject_drafts d join public.subjects s on s.id=d.subject_id
 where d.subject_id=pg_temp.sid('expiring')),'the draft subject is a purged tombstone');

select throws_ok($$select private.assert_account_path_b_deletion_supported_v1('0b5e0000-0000-4000-8000-000000000001')$$,
 '55000','unsupported_account_graph','account deletion refuses this flow''s graph, as it refuses the e-signature flow''s');

-- 8. Privileges ------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated','public.open_permission_document_session_v1(uuid,uuid,uuid,text,integer,text,text,bytea,text,boolean)','execute'),
 'only the service opens a document session');
select ok(not has_function_privilege('authenticated','public.finalize_path_b_reviewed_document_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb)','execute'),
 'only the service finalizes');
select ok(not has_function_privilege('service_role','private.assign_permission_document_review_v1(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','private.assign_permission_document_review_v1(uuid,uuid)','execute'),
 'no API role can assign a reviewer');
select ok(not has_function_privilege('anon','public.decide_permission_document_v1(uuid,text,bigint,text,text,bytea)','execute')
 and not has_function_privilege('service_role','public.decide_permission_document_v1(uuid,text,bigint,text,text,bytea)','execute'),
 'a decision is made only under a reviewer''s own JWT');
select ok(not has_table_privilege('service_role','private.permission_documents','select')
 and not has_table_privilege('authenticated','private.permission_document_reviews','select'),'no role reads the stores directly');

select * from finish();
rollback;
