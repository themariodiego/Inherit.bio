update public.mail_outbox set state='invalidated' where state in ('queued','claimed');
insert into private.upload_authorization_config(singleton,auth_issuer)
 values(true,'http://127.0.0.1:54321/auth/v1')
 on conflict(singleton) do update set auth_issuer=excluded.auth_issuer;
update private.upload_authorization_config set maximum_array_bytes=52428800,maximum_vcf_bytes=52428800,
 maximum_account_bytes=1073741824,maximum_active_uploads=32 where singleton;

-- 01 uploads; 02 is the person, with an account; 03 has an account and no
-- declaration; 04 is a person whose invitation is written after a rotation;
-- 09 is an outsider.
insert into auth.users(id,email,raw_user_meta_data) values
 ('0b5e0000-0000-4000-8000-000000000001','acct-uploader@e2e.local','{"display_name":"Synthetic uploader"}'),
 ('0b5e0000-0000-4000-8000-000000000002','acct-person@e2e.local','{"display_name":"Synthetic person"}'),
 ('0b5e0000-0000-4000-8000-000000000003','acct-undeclared@e2e.local','{"display_name":"Synthetic undeclared"}'),
 ('0b5e0000-0000-4000-8000-000000000004','acct-rotated@e2e.local','{"display_name":"Synthetic rotated"}'),
 ('0b5e0000-0000-4000-8000-000000000009','acct-outsider@e2e.local','{"display_name":"Synthetic outsider"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 select ('0b5e0000-0000-4000-8000-00000000001'||n)::uuid,('0b5e0000-0000-4000-8000-00000000000'||n)::uuid,now(),now(),'aal1'
 from unnest(array['1','2','3','4','9']) n;
update public.profiles set date_of_birth=date '1990-01-01' where id::text like '0b5e0000-%';
-- A current own jurisdiction declaration for everyone but 03.
update public.profiles p set jurisdiction_code='GB',jurisdiction_declared_at=clock_timestamp(),
 jurisdiction_attestation_version=a.version,jurisdiction_attestation_sha256=a.body_sha256
 from public.consent_artifacts a where a.artifact_key='attestation.jurisdiction' and a.superseded_at is null
  and p.id in ('0b5e0000-0000-4000-8000-000000000001','0b5e0000-0000-4000-8000-000000000002',
   '0b5e0000-0000-4000-8000-000000000004','0b5e0000-0000-4000-8000-000000000009');
update public.profiles set jurisdiction_code=null,jurisdiction_declared_at=null,jurisdiction_attestation_version=null,
 jurisdiction_attestation_sha256=null where id='0b5e0000-0000-4000-8000-000000000003';

-- Helpers ---------------------------------------------------------------------
create function pg_temp.a(p text) returns uuid language sql immutable as
 $$ select ('0b5e0000-0000-4000-8000-00000000000'||p)::uuid $$;
create function pg_temp.s(p text) returns uuid language sql immutable as
 $$ select ('0b5e0000-0000-4000-8000-00000000001'||p)::uuid $$;
create function pg_temp.kd(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('path-b-account:'||p,'sha256'),'hex') $$;
create function pg_temp.pair(p text) returns jsonb language sql immutable as
 $$ select jsonb_build_object('1',pg_temp.kd(p||'1'),'2',pg_temp.kd(p||'2')) $$;
create temporary table fx(name text primary key, subject_id uuid, token_hash text);
grant all on fx to service_role;
create function pg_temp.sid(p_name text) returns uuid language sql as $$ select subject_id from fx where name=p_name $$;
create function pg_temp.draft(p_name text,p_hmac text,p_set jsonb default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
 r:=public.create_path_b_adult_draft_v1(pg_temp.a('1'),pg_temp.s('1'),'Synthetic Relative',date '1980-05-05',
  decode('00112233445566778899aabbccddeeff','hex'),p_hmac,pg_temp.kd('request:'||p_name),true,p_contact_hmac_set=>p_set);
 insert into fx(name,subject_id) values(p_name,(r->>'subjectDraftId')::uuid) on conflict(name) do nothing;
 return r;
end;
$$;
create function pg_temp.present(p_subject uuid,p_nonce text) returns jsonb language sql as $$
 select public.present_other_adult_upload_artifact_v1(pg_temp.a('1'),pg_temp.s('1'),p_subject,repeat(p_nonce,64),
  clock_timestamp()+interval '9 minutes',true);
$$;
create function pg_temp.sign(p_subject uuid,p_nonce text) returns jsonb language sql as $$
 select public.sign_other_adult_upload_artifact_v1(pg_temp.a('1'),pg_temp.s('1'),p_subject,a.version,a.body_sha256,
  array['subject-alive-and-adult','subject-permission-held','lawfully-held-with-knowledge','contact-belongs-to-subject',
   'no-excluded-relationship','held-until-accepted','no-uploader-access'],decode(repeat('ab',24),'hex'),repeat(p_nonce,64),true)
 from public.consent_artifacts a where a.artifact_key='consent.upload-other-adult' and a.superseded_at is null;
$$;
create function pg_temp.invite(p_subject uuid,p_hmac text,p_set jsonb default null) returns jsonb language sql as $$
 select public.create_path_b_invitation_v1(pg_temp.a('1'),pg_temp.s('1'),p_subject,p_hmac,
  pg_temp.kd('idem:'||p_subject::text),true,p_contact_hmac_set=>p_set,p_quota_keys=>pg_temp.invitation_quota_keys());
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
end;
$$;
create function pg_temp.invitation_of(p_subject uuid) returns uuid language sql as $$
 select id from public.subject_invitations where target_kind='subject' and target_id=p_subject
  and invitation_kind='adult_subject' order by created_at desc limit 1
$$;
create function pg_temp.open_session(p_token_hash text,p_session text,p_form text) returns bigint language sql as $$
 select count(*) from public.activate_rights_session_v1(p_token_hash,repeat(p_session,64),p_form)
$$;
-- A draft signed and requested, its mail claimed and its request opened.
create function pg_temp.requested(p_name text,p_letter text,p_hmac text,p_set jsonb default null) returns uuid
language plpgsql as $$
declare v_subject uuid;
begin
 perform pg_temp.draft(p_name,p_hmac,p_set);
 v_subject:=pg_temp.sid(p_name);
 perform pg_temp.present(v_subject,p_letter);
 perform pg_temp.sign(v_subject,p_letter);
 perform pg_temp.invite(v_subject,p_hmac,p_set);
 update fx set token_hash=pg_temp.claim_for(pg_temp.invitation_of(v_subject)) where name=p_name;
 if pg_temp.open_session((select token_hash from fx where name=p_name),p_letter,'acct-open-'||p_letter||'aaaaaaaaaaaaaaaa')<>1 then
  raise exception 'request setup failed for %',p_name; end if;
 return v_subject;
end;
$$;
create function pg_temp.esig() returns public.consent_artifacts language sql as $$
 select * from public.consent_artifacts where artifact_key='consent.subject-adult-esignature' and superseded_at is null
$$;
-- The account confirmation, as the route calls it.
create function pg_temp.account_confirms(p_session text,p_nonce text,p_account text,p_hmac text,
 p_set jsonb default null,p_flag boolean default true,p_auth_session uuid default null) returns text language sql as $$
 select public.confirm_path_b_subject_account_v1(repeat(p_session,64),p_nonce,(pg_temp.esig()).version,
  (pg_temp.esig()).body_sha256,array['knows-uploader-has-file','agrees-to-upload','shown-what-uploader-sees',
   'may-withdraw-any-time'],decode(repeat('cd',24),'hex'),pg_temp.a(p_account),coalesce(p_auth_session,pg_temp.s(p_account)),
  p_hmac,p_flag,p_account_email_hmac_set=>p_set);
$$;
create function pg_temp.token_confirms(p_session text,p_nonce text) returns text language sql as $$
 select public.confirm_path_b_subject_v1(repeat(p_session,64),p_nonce,(pg_temp.esig()).version,(pg_temp.esig()).body_sha256,
  array['knows-uploader-has-file','agrees-to-upload','shown-what-uploader-sees','may-withdraw-any-time'],
  decode(repeat('cd',24),'hex'),'GB',true);
$$;
create temporary table held_fx(name text primary key, upload_id uuid, staging text, final_name text, object_id uuid,
 raw text, revision_id uuid);
grant all on held_fx to service_role;
create function pg_temp.hold(p_name text,p_subject uuid,p_hash text) returns jsonb language plpgsql as $$
declare r jsonb; m jsonb; v_object uuid:=gen_random_uuid(); v_result jsonb;
begin
 r:=public.issue_other_adult_held_upload_v1(pg_temp.a('1'),pg_temp.s('1'),p_subject,'VCF',8,p_hash,true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('role','service_role',true);
 insert into storage.objects(bucket_id,name,owner_id,metadata)
  values('genomes',r->>'stagingKey',pg_temp.a('1'),'{"size":8}');
 m:=public.begin_own_upload_finalization_v2(pg_temp.a('1'),pg_temp.s('1'),(r->>'uploadId')::uuid);
 insert into storage.objects(id,bucket_id,name,metadata) values(v_object,'genomes',m->>'finalKey','{"size":8}');
 perform set_config('role','postgres',true);
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where bucket_id='genomes' and name=r->>'stagingKey';
 perform set_config('role','service_role',true);
 v_result:=public.complete_own_upload_finalization_v1(pg_temp.a('1'),pg_temp.s('1'),(r->>'uploadId')::uuid,
  (m->>'claim')::uuid,v_object,p_hash,repeat('b',64));
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
  'acct-notice-'||p_session||'aaaaaaaaaaaaaa')
$$;
