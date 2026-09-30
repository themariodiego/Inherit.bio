-- Synthetic, rollback-only Path B queued normalization and source boundaries.
-- Real byte parsing is proven by the paired worker unit tests; these cases
-- exercise actual database claim, authorization, atomic publication and RLS.
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


update auth.users set created_at=now()-interval '1 day' where id::text like '0b5e0000-%';
select pg_temp.requested('main','a',repeat('a',64));
select is(pg_temp.account_confirms('a','norm-sign-aaaaaaaaaaaaaaaaaaa','2',repeat('a',64)),
 'accepted','the subject confirms with an independently existing account');
-- The uploader signs the actual current insurance artifact for their own
-- account context, independently of the Path B upload-class artifact.
create temporary table own_context as select private.own_upload_context_v1(pg_temp.a('1'),pg_temp.s('1'),s.id) c,s.id
 from public.subjects s where s.subject_class='self' and s.subject_account_id=pg_temp.a('1');
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 values(repeat('9',64),pg_temp.a('1'),pg_temp.s('1'),'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes');
select public.sign_own_upload_artifact_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from own_context),
 'disclosure.insurance-and-discrimination',a.version,a.body_sha256,array['understood'],
 (c->>'accountRevision')::bigint,(c->>'authSessionRevision')::bigint,(c->>'jurisdictionRevision')::bigint,
 (c->>'subjectBindingRevision')::bigint,(c->>'accountBindingRevision')::bigint,repeat('9',64))
 from own_context,public.consent_artifacts a where a.artifact_key='disclosure.insurance-and-discrimination' and a.superseded_at is null;
select pg_temp.hold('main',pg_temp.sid('main'),repeat('e',64));
select is((select count(*) from public.genome_files where subject_id=pg_temp.sid('main')),0::bigint,
 'an unconfirmed revision creates no source descriptor');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('main')),0::bigint,
 'an unconfirmed revision creates no normalization job');
select pg_temp.notice_session('main','1');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'norm-confirm-1111111111111111','confirm',pg_temp.a('2')),
 'confirmed','the person confirms this exact file revision');
select is((select count(*) from public.genome_files where subject_id=pg_temp.sid('main')),1::bigint,
 'confirmation creates one exact source descriptor after all common gates pass');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('main') and kind='annotate_vcf'
 and output_kind='ingest.normalize' and source_binding_kind='genome-file'
 and source_binding_id=pg_temp.fxv('main','revision')::uuid),1::bigint,
 'confirmation queues only the registered source-revision normalization identity');
select is((select count(*) from public.purpose_grants where target_id=pg_temp.sid('main')),0::bigint,
 'confirmation and queue admission do not create an analytic purpose');
select ok((private.claim_worker_job_v2('synthetic-generic',repeat('7',64),60)).id is distinct from
 (select id from public.worker_jobs where subject_id=pg_temp.sid('main')),
 'the generic worker never receives the dedicated Path B job');
select throws_ok($$select public.path_b_normalization_v1('claim',null,repeat('8',64),null,null,false)$$,
 '42501','not_found','the test jurisdiction is required at claim');
create temporary table norm_manifest(c jsonb);
insert into norm_manifest select public.path_b_normalization_v1('claim',null,repeat('8',64),null,null,true);
grant select on norm_manifest,fx,held_fx to authenticated;
select is((select c->>'fileId' from norm_manifest),pg_temp.fxv('main','revision'),
 'the worker claims exactly the confirmed revision descriptor');
create function pg_temp.norm(p_operation text,p_payload jsonb default null) returns jsonb language sql as $$
 select public.path_b_normalization_v1(p_operation,(c->>'jobId')::uuid,repeat('8',64),(c->>'claim')::uuid,p_payload,true)
 from norm_manifest;
$$;
select is(pg_temp.norm('check'),(select c from norm_manifest),'each range has the identical current source manifest');
select throws_ok($$select public.path_b_normalization_v1('check',(select (c->>'jobId')::uuid from norm_manifest),
 repeat('7',64),(select (c->>'claim')::uuid from norm_manifest),null,true)$$,
 '42501','not_found','a different claim hash cannot read the source');
select is(public.register_path_b_normalization_positions_v1((select (c->>'jobId')::uuid from norm_manifest),
 repeat('8',64),pg_temp.fxv('main','revision')::uuid,(select (c->>'claim')::uuid from norm_manifest),0,'GRCh38',
 '[{"source_chrom":1,"source_pos":100000,"variant":{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"},"mapped":null}]',true),
 '{"acceptedVariantOrdinals":[0],"attempted":0,"unmapped":0}'::jsonb,'the exact claim owns bounded source-position registration');
select is(pg_temp.norm('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}'),
 'true'::jsonb,'canonical rows stage privately under the same current claim');
select is((select count(*) from public.user_variants where file_id=pg_temp.fxv('main','revision')::uuid),0::bigint,
 'staging exposes no canonical genetic rows');
select throws_ok($$select pg_temp.norm('stage','{"kind":"variants","sequence":0,"rows":[{}]}')$$,
 '22023','invalid_request','duplicate stage sequence is rejected');
-- A synthetic trigger models time expiry during the private INSERT itself;
-- the same SQL statement must roll back both the staged row and the mutation.
create function pg_temp.expire_stage_claim() returns trigger language plpgsql as $$
begin
 update private.own_normalization_runs set expires_at=clock_timestamp()-interval '1 second' where file_id=new.file_id;
 return new;
end;
$$;
create trigger synthetic_expire_path_b_stage after insert on private.own_normalization_batches
 for each row execute function pg_temp.expire_stage_claim();
select throws_ok($$select pg_temp.norm('stage','{"kind":"variants","sequence":1,"rows":[{"rsid":124,"chrom":1,"pos":100001,"ref":"A","alt":"G","genotype":"A/G"}]}')$$,
 '42501','not_found','expiry inside the stage write rolls back its whole statement');
select is((select count(*) from private.own_normalization_batches where file_id=pg_temp.fxv('main','revision')::uuid),1::bigint,
 'the failed statement adds no extra staged genetic row');
select ok((select expires_at>clock_timestamp() from private.own_normalization_runs where file_id=pg_temp.fxv('main','revision')::uuid),
 'the failed statement also rolls back its synthetic deadline mutation');
drop trigger synthetic_expire_path_b_stage on private.own_normalization_batches;
select throws_ok($$select pg_temp.norm('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('f',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb))$$,
 '22023','invalid_request','a different source hash cannot publish canonical rows');
select is(pg_temp.norm('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('e',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,
 'provenance',jsonb_build_object('version','path-b-normalization-v1','sourceRevision',1,'liftoverSha256',null,'attempted',0,'unmapped',0))),
 jsonb_build_object('fileId',pg_temp.fxv('main','revision'),'status','normalization_complete','analysisState','not_generated'),
 'terminal publication returns only normalization completion, never report readiness');
select is((select count(*) from public.user_variants where file_id=pg_temp.fxv('main','revision')::uuid),1::bigint,
 'the final fenced transaction publishes the complete synthetic canonical batch');
select is((select count(*) from private.own_normalization_batches where file_id=pg_temp.fxv('main','revision')::uuid),0::bigint,
 'successful publication deletes all private staged genetic rows');
select ok((select status='done' and claim_token_hash is null and claim_expires_at is null
 from public.worker_jobs where subject_id=pg_temp.sid('main')),'the completed worker claim has no live bearer');
select is((select count(*) from public.purpose_grants where target_id=pg_temp.sid('main')),0::bigint,
 'normalization creates no analytic purpose');
select throws_ok($$select pg_temp.norm('fail')$$,'42501','not_found','late cleanup cannot erase completed canonical rows');
select is(private.path_b_result_read_v1(pg_temp.a('1'),pg_temp.sid('main'),'reports.monogenic')->>'gate',
 'directional-purpose-grant-v1','normalization cannot authorize uploader reading');
select is(private.path_b_result_read_v1(pg_temp.a('2'),pg_temp.sid('main'),'reports.monogenic')->>'gate',
 'directional-purpose-grant-v1','normalization cannot authorize the subject''s analytic reading');
-- A real exact-purpose grant advances the source gate, never the execution gate.
select public.grant_path_b_purpose_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),'reports.monogenic','self',
 a.version,a.body_sha256,repeat('6',64),clock_timestamp()+interval '5 minutes',true)
 from public.consent_artifacts a where a.artifact_key='consent.own-monogenic' and a.superseded_at is null;
select is(private.path_b_result_read_v1(pg_temp.a('2'),pg_temp.sid('main'),'reports.monogenic')->>'gate',
 'analysis-not-generated','the exact granted layer sees completed source and the separate execution gate');
select is(private.path_b_result_read_v1(pg_temp.a('1'),pg_temp.sid('main'),'reports.monogenic')->>'gate',
 'directional-purpose-grant-v1','the subject''s own result grant does not share it with the uploader');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0b5e0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*) from public.genome_files where id=(select (c->>'fileId')::uuid from norm_manifest)),0::bigint,
 'legacy file ownership exposes no Path B descriptor to its uploader');
select is((select count(*) from public.user_variants where file_id=(select (c->>'fileId')::uuid from norm_manifest)),0::bigint,
 'legacy variant ownership exposes no Path B genetic data to its uploader');
reset role;
select ok(not has_function_privilege('authenticated','public.path_b_normalization_v1(text,uuid,text,uuid,jsonb,boolean)','EXECUTE'),
 'an authenticated browser cannot claim or publish normalization');
select ok(not has_function_privilege('inherit_upload_only','public.path_b_normalization_v1(text,uuid,text,uuid,jsonb,boolean)','EXECUTE'),
 'an upload-only credential cannot claim or publish normalization');
select ok(private.end_other_adult_held_upload_v1(pg_temp.fxv('main','revision')::uuid,'deleted'),
 'the existing exact source disposition ends a normalized revision');
select is((select count(*) from public.genome_files where subject_id=pg_temp.sid('main'))
 +(select count(*) from public.user_variants where subject_id=pg_temp.sid('main'))
 +(select count(*) from public.worker_jobs where subject_id=pg_temp.sid('main')),0::bigint,
 'the same source disposition removes its descriptor, canonical rows and job');
select is((select count(*) from storage.objects where id=pg_temp.fxv('main','object')::uuid),1::bigint,
 'the original handle remains for the existing proven storage deletion executor');
select is((select count(*) from public.upload_staging_objects where upload_session_id=pg_temp.fxv('main','upload')::uuid
 and object_name=pg_temp.fxv('main','final')),1::bigint,'cleanup retains the exact original reference until object deletion is proved');
-- Revocation after staging is checked against actual current DB evidence.
select pg_temp.requested('revoked','b',repeat('b',64));
select is(pg_temp.account_confirms('b','norm-sign-bbbbbbbbbbbbbbbbbbb','2',repeat('b',64)),
 'accepted','a separate synthetic revision has its own subject confirmation');
select pg_temp.hold('revoked',pg_temp.sid('revoked'),repeat('d',64));
select pg_temp.notice_session('revoked','2');
select is(public.respond_adult_upload_revision_v1(repeat('2',64),'norm-confirm-2222222222222222','confirm',pg_temp.a('2')),
 'confirmed','the separate revision is confirmed before claim');
update norm_manifest set c=public.path_b_normalization_v1('claim',null,repeat('8',64),null,null,true);
select is(pg_temp.norm('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}'),
 'true'::jsonb,'a separate current claim stages a private batch');
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where subject_id=pg_temp.sid('revoked') and consent_type='upload_class';
select throws_ok($$select pg_temp.norm('check')$$,'42501','not_found','revocation denies the next bounded source read');
select throws_ok($$select pg_temp.norm('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('d',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb))$$,
 '42501','not_found','revocation denies publication of already staged batches');
select is(pg_temp.norm('fail'),'true'::jsonb,'exact private cleanup remains available after permission revocation');
select is((select count(*) from private.own_normalization_batches where file_id=pg_temp.fxv('revoked','revision')::uuid)
 +(select count(*) from public.user_variants where file_id=pg_temp.fxv('revoked','revision')::uuid),0::bigint,
 'revoked source leaves neither private staged rows nor published genetic rows');
select * from finish();
rollback;
