-- api.subject-delete, adult case, for the reviewed-document branch of Path B
-- (migration 20261016220000_subject_delete_reviewed_document; owner decision
-- 2026-10-16, "The subjects endpoints (G2.1)"). A confirmed reviewed-document
-- record is the same uploader-owned other_adult record as an e-signature one,
-- and its uploader can delete it through the one door: its held file ends as
-- withdrawn, the record is purged, its contact is shredded and no bar is
-- written. Anyone else is not found and nothing is written. The setup is the
-- reviewed-document suite's own (supabase/tests/path_b_reviewed_document.sql),
-- up to the person's signature. Synthetic accounts, documents and files only.
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


-- One confirmed reviewed-document record, through the real doors ------------------
select pg_temp.approved('main','a');
select is(pg_temp.finalize('main','a','main'),jsonb_build_object('status','received','next','awaiting_subject_confirmation'),
 'fixture: the approved draft is requested');
update fx set token_hash=pg_temp.claim_for(pg_temp.invitation_of(pg_temp.sid('main'))) where name='main';
select is((select count(*) from public.activate_rights_session_v1((select token_hash from fx where name='main'),
 repeat('a',64),'reviewed-open-aaaaaaaaaaaaaaaa')),1::bigint,'fixture: the person opens the request mail');
select is(pg_temp.person_signs('a','reviewed-sign-aaaaaaaaaaaaaaaa'),'accepted','fixture: the person signs their own Path B text');
set constraints all immediate;
set constraints all deferred;
create temporary table held as select pg_temp.issue(pg_temp.sid('main')) r;
select ok((select s.lifecycle='active' and s.owner_account_id='0b5e0000-0000-4000-8000-000000000001'
  and s.subject_account_id is null and d.adult_flow='path-b-reviewed-document' and d.state='confirmed'
 from public.subjects s join public.adult_subject_drafts d on d.subject_id=s.id where s.id=pg_temp.sid('main')),
 'fixture: the uploader owns a confirmed reviewed-document record');
-- The held file, finalized as the upload route does.
create function pg_temp.hold_main() returns jsonb language plpgsql as $$
declare r jsonb:=(select r from held); m jsonb; v_object uuid:=gen_random_uuid(); v_result jsonb;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('role','service_role',true);
 insert into storage.objects(bucket_id,name,owner_id,metadata)
  values('genomes',r->>'stagingKey','0b5e0000-0000-4000-8000-000000000001','{"size":8}');
 m:=public.begin_own_upload_finalization_v2('0b5e0000-0000-4000-8000-000000000001','0b5e0000-0000-4000-8000-000000000011',
  (r->>'uploadId')::uuid);
 insert into storage.objects(id,bucket_id,name,metadata) values(v_object,'genomes',m->>'finalKey','{"size":8}');
 perform set_config('role','postgres',true);
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where bucket_id='genomes' and name=r->>'stagingKey';
 perform set_config('role','service_role',true);
 v_result:=public.complete_own_upload_finalization_v1('0b5e0000-0000-4000-8000-000000000001',
  '0b5e0000-0000-4000-8000-000000000011',(r->>'uploadId')::uuid,(m->>'claim')::uuid,v_object,repeat('e',64),repeat('b',64));
 perform set_config('role','postgres',true);
 return v_result;
end $$;
select is((select h->>'status' from (select pg_temp.hold_main() h) x),'stored_quarantined','fixture: a file is held for the record');
create temporary table contact as select e.contact_hmac from public.encrypted_contact_references e
 join public.subject_principals sp on sp.id=e.principal_id where sp.subject_id=pg_temp.sid('main') and e.status='current';
select ok((select count(*) from contact)>0,'fixture: the record holds a current contact reference');

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('subject-delete-reviewed:'||p,'sha256'),'hex') $$;
create function pg_temp.del(p_account uuid,p_session uuid,p_code text) returns jsonb language sql volatile as
 $$ select public.delete_subject_v1(p_account,p_session,pg_temp.sid('main'),pg_temp.h(p_code),clock_timestamp()+interval '5 minutes') $$;

-- Not found for anyone else ------------------------------------------------------------
select throws_ok($$select pg_temp.del('0b5e0000-0000-4000-8000-000000000009','0b5e0000-0000-4000-8000-000000000019','outsider')$$,
 '42501','not_found','an outsider cannot delete a reviewed-document record');
select throws_ok($$select pg_temp.del('0b5e0000-0000-4000-8000-000000000003','0b5e0000-0000-4000-8000-000000000013','reviewer')$$,
 '42501','not_found','the named reviewer of its document cannot delete it either');
select ok((select count(*) from public.account_operation_nonces where operation='subject_delete')=0
 and (select lifecycle from public.subjects where id=pg_temp.sid('main'))='active'
 and (select state from public.other_adult_held_uploads where subject_id=pg_temp.sid('main'))='pending',
 'a refused delete records no code and ends nothing');

-- The uploader deletes it: withdrawn, purged, shredded, no bar --------------------------
set local role service_role;
create temporary table uploader_delete as select pg_temp.del('0b5e0000-0000-4000-8000-000000000001',
 '0b5e0000-0000-4000-8000-000000000011','uploader') body;
reset role;
select is((select body from uploader_delete),'{"case":"adult"}'::jsonb,'the uploader''s delete is the adult case');
select is((select lifecycle from public.subjects where id=pg_temp.sid('main')),'purged','the record is purged');
select is((select state from public.other_adult_held_uploads where subject_id=pg_temp.sid('main')),'withdrawn',
 'its held file ends as withdrawn');
select ok((select status='rejected' and finalization_cleanup_pending from public.upload_sessions
 where id=(select (r->>'uploadId')::uuid from held)),'the held upload session is handed to the upload-working executor');
select is((select count(*) from public.encrypted_contact_references e join public.subject_principals sp on sp.id=e.principal_id
 where sp.subject_id=pg_temp.sid('main') and (e.status='current' or e.contact_ciphertext is not null)),0::bigint,
 'its contact is shredded');
select is((select count(*) from public.contact_refusal_bars where target_kind='subject' and target_id=pg_temp.sid('main')),0::bigint,
 'an uploader''s delete writes no subject-controlled refusal bar');
select is((select count(*) from public.account_operation_nonces where operation='subject_delete'
 and nonce_hash=pg_temp.h('uploader')),1::bigint,'the code is recorded once, in the same transaction');
set constraints all immediate;
select ok((select wrapped_document_key is null from private.permission_document_sessions
 where id=(select session_id from fx where name='main')) or (select retain_until>clock_timestamp()
 from private.permission_documents where id=pg_temp.fx_doc('main')),
 'the permission document follows its own retention: its key is shredded unless its fixed post-acceptance deadline keeps it');
set constraints all deferred;
select throws_ok($$select pg_temp.del('0b5e0000-0000-4000-8000-000000000001','0b5e0000-0000-4000-8000-000000000011','again')$$,
 '42501','not_found','a purged record is not found again');

select * from finish();
rollback;
