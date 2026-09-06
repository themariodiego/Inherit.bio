begin;
select no_plan();
-- pgTAP itself lives in extensions. This transaction-only harness grant is
-- not part of the role migration and grants no table or object access.
grant usage on schema extensions to inherit_upload_only;
insert into private.upload_authorization_config(singleton,auth_issuer)
 values(true,'http://127.0.0.1:54321/auth/v1')
 on conflict(singleton) do update set auth_issuer=excluded.auth_issuer;
insert into auth.users(id,email,raw_user_meta_data) values
 ('76200000-0000-4000-8000-000000000001','upload-role@e2e.local','{"display_name":"Synthetic uploader"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('76200000-0000-4000-8000-000000000010','76200000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='76200000-0000-4000-8000-000000000001';
create temporary table upload_role_subject as select id from public.subjects
 where subject_account_id='76200000-0000-4000-8000-000000000001' and subject_class='self';
create function pg_temp.issue_role_upload() returns jsonb language sql as $$
 select public.issue_own_storage_upload_v1('76200000-0000-4000-8000-000000000001',
 '76200000-0000-4000-8000-000000000010',(select id from upload_role_subject),'VCF',8,repeat('a',64));
$$;
select throws_ok($$select pg_temp.issue_role_upload()$$,'55000','insurance_acknowledgement_required',
 'the atomic issuer refuses a live account without its separate disclosure');
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'76200000-0000-4000-8000-000000000001',
 '76200000-0000-4000-8000-000000000010','own_upload_artifact_sign',clock_timestamp()+interval '9 minutes'
 from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('76200000-0000-4000-8000-000000000001',
 '76200000-0000-4000-8000-000000000010',(select id from upload_role_subject),
 'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select throws_ok($$select pg_temp.issue_role_upload()$$,'55000','upload_consent_required',
 'the atomic issuer does not treat disclosure as upload consent');
select public.sign_own_upload_artifact_v1('76200000-0000-4000-8000-000000000001',
 '76200000-0000-4000-8000-000000000010',(select id from upload_role_subject),
 'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
create temporary table role_upload as select pg_temp.issue_role_upload() receipt;
grant select on role_upload to service_role;
select throws_ok($$update public.upload_sessions set declared_format=null
 where id=(select (receipt->>'uploadId')::uuid from role_upload)$$,
 '23514',null,'token-bound sessions require a non-null declared format');
select is((select count(*) from public.upload_sessions where account_id='76200000-0000-4000-8000-000000000001'),
 1::bigint,'only the authorized issuance creates a durable session');
select is((select count(*) from public.purpose_grants where target_id=(select id from upload_role_subject)),
 0::bigint,'byte storage does not require or invent analytic permission');
create function pg_temp.set_upload_claims(p_patch jsonb default '{}'::jsonb) returns void language plpgsql as $$
declare r jsonb;
begin
 select receipt into r from role_upload;
 perform set_config('request.jwt.claims',(jsonb_build_object(
  'iss','http://127.0.0.1:54321/auth/v1','aud','inherit-storage-upload','role','inherit_upload_only',
  'sub',r->>'accountId','session_id',r->>'sessionId','account_auth_session_revision',r->'accountAuthSessionRevision',
  'upload_session_id',r->>'uploadId','jti',r->>'jti','staging_key',r->>'stagingKey','maximum_bytes',r->'maximumBytes',
  'iat',floor(extract(epoch from clock_timestamp())),'nbf',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from (r->>'expiresAt')::timestamptz)))||p_patch)::text,true);
end;
$$;
select pg_temp.set_upload_claims();
set local role inherit_upload_only;
select is(private.authorize_storage_upload_insert(),true,'the exact live bearer authorizes its one insert');
select is(private.assert_live_authenticated_session(),jsonb_build_object('authorized',true,
 'account_auth_session_revision',1,'session_revision',1),'the live-session helper returns no identity data');
select throws_ok($$select * from public.upload_sessions$$,'42501',null,'the bearer cannot read its own session table');
select throws_ok($$select * from public.profiles$$,'42501',null,'the bearer cannot read profiles');
select throws_ok($$select * from storage.objects$$,'42501',null,'the bearer cannot read or list stored objects');
select throws_ok($$update storage.objects set metadata='{}'::jsonb$$,'42501',null,'the bearer cannot update or upsert objects');
select throws_ok($$delete from storage.objects$$,'42501',null,'the bearer cannot delete objects');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata)
 values('genomes',gen_random_uuid()::text,'{"size":8}')$$,'42501',null,'another object key is denied');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata)
 values('genomes-staging',current_setting('request.jwt.claims')::jsonb->>'staging_key','{"size":8}')$$,
 '42501',null,'another bucket is denied');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata)
 values('genomes',current_setting('request.jwt.claims')::jsonb->>'staging_key','{"size":9}')$$,
 '42501',null,'a body beyond this upload size is denied');
select lives_ok($$insert into storage.objects(bucket_id,name,metadata)
 values('genomes',current_setting('request.jwt.claims')::jsonb->>'staging_key','{"size":8}')$$,
 'the exact authorized object is created without any SELECT privilege');
select is(private.authorize_storage_upload_insert(),false,'successful insert consumes the create-only bearer');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata)
 values('genomes',current_setting('request.jwt.claims')::jsonb->>'staging_key','{"size":8}')$$,
 '42501',null,'the same bearer cannot insert again');
reset role;
select is((select status from public.upload_sessions where id=(select (receipt->>'uploadId')::uuid from role_upload)),
 'uploaded','the insert and bearer consumption commit as one transaction');
-- A second legitimate upload provides a fresh unused bearer for revocation tests.
update role_upload set receipt=pg_temp.issue_role_upload();
select pg_temp.set_upload_claims();
savepoint provider_probe;
set local role inherit_upload_only;
select lives_ok($$insert into storage.objects(bucket_id,name,metadata)
 values('genomes',current_setting('request.jwt.claims')::jsonb->>'staging_key','{"contentLength":8,"mimetype":"application/octet-stream"}')$$,
 'the provider permission probe accepts its actual declared-length metadata');
reset role;
select is((select status from public.upload_sessions where id=(select (receipt->>'uploadId')::uuid from role_upload)),
 'uploaded','even a direct committed probe-shaped insert consumes its bearer');
rollback to provider_probe;
select is((select status from public.upload_sessions where id=(select (receipt->>'uploadId')::uuid from role_upload)),
 'issued','the provider probe rollback restores the unconsumed session');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from role_upload),'76200000-0000-4000-8000-000000000001','{"size":7}')$$,
 '42501',null,'elevated completion rejects an incomplete body');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata)
 values('genomes',(select receipt->>'stagingKey' from role_upload),'{"size":8}')$$,
 '42501',null,'elevated completion must preserve the exact uploader owner');
reset role;
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where account_id='76200000-0000-4000-8000-000000000001' and consent_type='upload_class';
set local role service_role;
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from role_upload),'76200000-0000-4000-8000-000000000001','{"size":8}')$$,
 '42501','upload_unavailable','elevated completion rechecks consent withdrawn after the probe');
reset role;
update public.subject_consents set revoked_at=null,revocation_reason=null
 where account_id='76200000-0000-4000-8000-000000000001' and consent_type='upload_class';
set local role service_role;
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from role_upload),'76200000-0000-4000-8000-000000000001','{"size":8}')$$,
 'elevated final insertion succeeds with exact bytes and current authority');
select throws_ok($$update storage.objects set metadata='{"size":9}'
 where name=(select receipt->>'stagingKey' from role_upload) and bucket_id='genomes'$$,
 '42501',null,'even elevated writes cannot replace completed staging content');
select throws_ok($$update storage.objects set name=gen_random_uuid()::text
 where name=(select receipt->>'stagingKey' from role_upload) and bucket_id='genomes'$$,
 '42501',null,'elevated renaming cannot bypass the staging immutability check');
reset role;
select is((select status from public.upload_sessions where id=(select (receipt->>'uploadId')::uuid from role_upload)),
 'uploaded','elevated completion durably consumes the exact session');
update role_upload set receipt=pg_temp.issue_role_upload();
select pg_temp.set_upload_claims();
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where account_id='76200000-0000-4000-8000-000000000001' and consent_type='upload_class';
set local role inherit_upload_only;
select is(private.authorize_storage_upload_insert(),false,'withdrawing class consent immediately refuses the outstanding token');
reset role;
update public.subject_consents set revoked_at=null,revocation_reason=null
 where account_id='76200000-0000-4000-8000-000000000001' and consent_type='upload_class';
update public.profiles set auth_session_revision=2 where id='76200000-0000-4000-8000-000000000001';
set local role inherit_upload_only;
select is(private.authorize_storage_upload_insert(),false,'an account session revision change refuses the outstanding token');
reset role;
update public.profiles set auth_session_revision=1 where id='76200000-0000-4000-8000-000000000001';
update auth.sessions set refresh_token_counter=1 where id='76200000-0000-4000-8000-000000000010';
set local role inherit_upload_only;
select is(private.authorize_storage_upload_insert(),false,'originating session revision changes independently refuse the token');
reset role;
update auth.sessions set refresh_token_counter=null where id='76200000-0000-4000-8000-000000000010';
update public.subjects set lifecycle_revision=lifecycle_revision+1 where id=(select id from upload_role_subject);
set local role inherit_upload_only;
select is(private.authorize_storage_upload_insert(),false,'a changed subject lifecycle refuses the stored snapshot');
reset role;
update public.subjects set lifecycle_revision=lifecycle_revision-1 where id=(select id from upload_role_subject);
update public.profiles set deletion_requested_at=clock_timestamp() where id='76200000-0000-4000-8000-000000000001';
set local role inherit_upload_only;
select is(private.authorize_storage_upload_insert(),false,'a deletion hold refuses the upload without exposing account state');
reset role;
update public.profiles set deletion_requested_at=null where id='76200000-0000-4000-8000-000000000001';
update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id='76200000-0000-4000-8000-000000000001';
set local role inherit_upload_only;
select is(private.authorize_storage_upload_insert(),false,'a suspended account cannot use the outstanding token');
reset role;
update auth.users set banned_until=null where id='76200000-0000-4000-8000-000000000001';
select pg_temp.set_upload_claims('{"maximum_bytes":9}');
set local role inherit_upload_only;
select is(private.authorize_storage_upload_insert(),false,'a changed size claim cannot enlarge the session');
reset role;
select pg_temp.set_upload_claims('{"iss":"https://inherit.bio/auth/v1"}');
set local role inherit_upload_only;
select is(private.authorize_storage_upload_insert(),false,'the exact configured issuer is mandatory');
reset role;
select pg_temp.set_upload_claims('{"role":null}');
set local role inherit_upload_only;
select is(private.assert_live_authenticated_session(),'{"authorized":false}'::jsonb,'a missing role fails the general session helper');
reset role;
select pg_temp.set_upload_claims();
delete from auth.sessions where id='76200000-0000-4000-8000-000000000010';
set local role inherit_upload_only;
select is(private.authorize_storage_upload_insert(),false,'deleting the originating session immediately denies the token');
reset role;
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prosecdef
 and has_function_privilege('inherit_upload_only',p.oid,'execute')),2::bigint,
 'only the approved two private definer predicates are callable by the upload role');
select ok(not has_function_privilege('authenticated','private.authorize_storage_upload_insert()','execute')
 and not has_function_privilege('anon','private.authorize_storage_upload_insert()','execute'),
 'ordinary browser roles receive no new upload predicate privilege');
select * from finish();
rollback;
