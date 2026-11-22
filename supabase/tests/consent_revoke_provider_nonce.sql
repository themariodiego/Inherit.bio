begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- G8.5, api.consent-revoke (20261025200000_consent_revoke_provider_nonce.sql;
-- owner decision of 23 October 2026, item 1: the code moves to the register).
-- The cloud-model provider grant and the own-Copilot permission each gain a
-- door that records the hash of the nonce their page rendered, through the
-- account operation consumer, in the same transaction and before the
-- unchanged writer revokes. A replayed, foreign, expired or malformed nonce
-- revokes nothing.
--
-- Every account, session, address and key is synthetic, and everything rolls
-- back. The route verifies a nonce's MAC before it reaches a door
-- (src/lib/person-operation-nonce.ts); the hashes here are synthetic.
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads)
 values(true,'http://127.0.0.1:54321/auth/v1',65536,65536,262144,2)
 on conflict(singleton) do update set auth_issuer=excluded.auth_issuer,
 maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes,
 maximum_account_bytes=excluded.maximum_account_bytes,maximum_active_uploads=excluded.maximum_active_uploads;
do $$ declare n integer; begin
 for n in 1..2 loop
  insert into auth.users(id,email,email_confirmed_at) values(('7c6e0000-0000-4000-8000-00000000000'||n)::uuid,'consent-revoke-'||n||'@e2e.local',now());
  insert into auth.sessions(id,user_id,created_at,updated_at,aal) values(('7c6e0000-0000-4000-8000-00000000001'||n)::uuid,
   ('7c6e0000-0000-4000-8000-00000000000'||n)::uuid,now(),now(),'aal1');
  update public.profiles set date_of_birth='1990-01-01' where id=('7c6e0000-0000-4000-8000-00000000000'||n)::uuid;
 end loop;
end $$;
create function pg_temp.account(n integer) returns uuid language sql immutable as $$ select ('7c6e0000-0000-4000-8000-00000000000'||n)::uuid $$;
create function pg_temp.session(n integer) returns uuid language sql immutable as $$ select ('7c6e0000-0000-4000-8000-00000000001'||n)::uuid $$;
create function pg_temp.hash(label text) returns text language sql immutable as $$ select encode(extensions.digest(convert_to(label,'UTF8'),'sha256'),'hex') $$;
create function pg_temp.soon() returns timestamptz language sql as $$ select clock_timestamp()+interval '5 minutes' $$;

-- 1. The cloud-model provider grant.
create temporary table cloud_grants as select n, public.grant_cloud_model_consent(pg_temp.account(n),'model.synthetic.invalid',
 array['genotypes','variant-search','report-interpretations','score-coverage','chat-messages']) id from generate_series(1,2) n;
create function pg_temp.cloud(n integer) returns uuid language sql as $$ select id from cloud_grants where cloud_grants.n=$1 $$;
create function pg_temp.live(n integer) returns boolean language sql as $$
 select exists(select 1 from public.consent_grants where id=pg_temp.cloud(n) and revoked_at is null)
  and exists(select 1 from public.subject_consents where account_id=pg_temp.account(n) and consent_type='cloud_model'
   and provider_key='model.synthetic.invalid' and revoked_at is null) $$;
create function pg_temp.revoke_cloud(n integer,grant_of integer,nonce text,session_of integer default null,expires timestamptz default null)
 returns boolean language sql as $$
 select public.revoke_cloud_model_consent_with_nonce_v1(pg_temp.account(n),pg_temp.session(coalesce(session_of,n)),pg_temp.cloud(grant_of),
  pg_temp.hash(nonce),coalesce(expires,pg_temp.soon()));
$$;
select ok(pg_temp.live(1) and pg_temp.live(2),'two accounts each hold a live provider grant');

select throws_ok($$select pg_temp.revoke_cloud(1,1,'cloud-foreign',2)$$,'42501','operation unavailable','a session of another account is refused');
select throws_ok($$select pg_temp.revoke_cloud(1,1,'cloud-expired',null,clock_timestamp()-interval '1 second')$$,'22023','invalid_operation_nonce',
 'an expired nonce is refused');
select throws_ok($$select pg_temp.revoke_cloud(1,1,'cloud-distant',null,clock_timestamp()+interval '11 minutes')$$,'22023','invalid_operation_nonce',
 'an expiry beyond ten minutes is refused');
select throws_ok($$select public.revoke_cloud_model_consent_with_nonce_v1(pg_temp.account(1),pg_temp.session(1),pg_temp.cloud(1),'not-a-hash',pg_temp.soon())$$,
 '22023','invalid_operation_nonce','a malformed hash is refused');
select ok(pg_temp.live(1),'none of the refusals revoked the grant');
select is((select count(*) from public.account_operation_nonces where account_id=pg_temp.account(1)
  and nonce_hash in (pg_temp.hash('cloud-foreign'),pg_temp.hash('cloud-expired'),pg_temp.hash('cloud-distant'))),0::bigint,
 'and none of them recorded a nonce');

select is(pg_temp.revoke_cloud(1,2,'cloud-other-grant'),false,'another account''s grant is not revoked through this account');
select ok(pg_temp.live(2),'the other account''s grant stays live');
select is(pg_temp.revoke_cloud(1,1,'cloud-one'),true,'the door revokes the provider grant with the page''s nonce');
select ok(not pg_temp.live(1),'the grant is revoked');
select ok(exists(select 1 from public.account_operation_nonces where nonce_hash=pg_temp.hash('cloud-one')
  and account_id=pg_temp.account(1) and session_id=pg_temp.session(1) and operation='consent_revoke' and consumed_at is not null),
 'the nonce is recorded consumed for this account, session and operation');
select throws_ok($$select pg_temp.revoke_cloud(1,1,'cloud-one')$$,'22023','invalid_operation_nonce','a replayed nonce is refused');

-- 2. The own-Copilot permission, granted through the real doors.
create temporary table copilot_subject as select id from public.subjects
 where subject_account_id=pg_temp.account(1) and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),pg_temp.account(1),pg_temp.session(1),'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes'
 from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1(pg_temp.account(1),pg_temp.session(1),(select id from copilot_subject),
 'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1(pg_temp.account(1),pg_temp.session(1),(select id from copilot_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
select is(public.save_own_copilot_settings_v1(pg_temp.account(1),pg_temp.session(1),
 jsonb_build_object('provider','openai_compatible','baseUrl','https://model.synthetic.invalid/v1','model','synthetic-model',
  'origin','https://model.synthetic.invalid','providerLabel','Synthetic model','providerClass','cloud','runtimeAttestationFingerprint',repeat('a',64)),
 null,repeat('b',64),null)->>'saved','true','the first account saves a key-free cloud provider');
create temporary table presented as select public.own_copilot_presentation_v1(pg_temp.account(1),pg_temp.session(1),(select id from copilot_subject)) value;
create temporary table granted as select public.grant_own_copilot_v1(pg_temp.account(1),pg_temp.session(1),(select id from copilot_subject),
 (select value->'snapshot' from presented),(select value->'artifacts' from presented),repeat('c',64),clock_timestamp()+interval '9 minutes') value;
create function pg_temp.authority() returns jsonb language sql as $$
 select public.own_copilot_authority_v1(pg_temp.account(1),pg_temp.session(1),(select id from copilot_subject),null) $$;
create function pg_temp.revoke_copilot(nonce text,session_of integer default 1) returns boolean language sql as $$
 select public.revoke_own_copilot_with_nonce_v1(pg_temp.account(1),pg_temp.session(session_of),(select id from copilot_subject),
  (select value from granted),pg_temp.hash(nonce),pg_temp.soon());
$$;
select ok(pg_temp.authority() is not null,'the own-Copilot permission is live');

select throws_ok($$select pg_temp.revoke_copilot('copilot-foreign',2)$$,'42501','operation unavailable','a session of another account is refused');
select throws_ok($$select public.revoke_own_copilot_with_nonce_v1(pg_temp.account(1),pg_temp.session(1),(select id from copilot_subject),
  (select value from granted),'not-a-hash',pg_temp.soon())$$,'22023','invalid_operation_nonce','a malformed hash is refused');
select ok(pg_temp.authority() is not null,'neither refusal revoked the permission');
select is(pg_temp.revoke_copilot('copilot-one'),true,'the door revokes the own-Copilot permission with the page''s nonce');
select ok(pg_temp.authority() is null,'the permission no longer authorizes Copilot');
select ok(exists(select 1 from public.purpose_grants where grant_id=((select value from granted)->>'copilotGrantId')::uuid
  and revoked_at is not null and revocation_reason='withdrawn'),'the purpose grant is revoked as withdrawn');
select ok(exists(select 1 from public.account_operation_nonces where nonce_hash=pg_temp.hash('copilot-one')
  and account_id=pg_temp.account(1) and session_id=pg_temp.session(1) and operation='consent_revoke' and consumed_at is not null),
 'the nonce is recorded consumed for this account, session and operation');
select throws_ok($$select pg_temp.revoke_copilot('copilot-one')$$,'22023','invalid_operation_nonce','a replayed nonce is refused');

-- 3. Who may call the doors, and what the writers are.
select ok(has_function_privilege('service_role',f,'execute'),'the service role may call '||f) from unnest(array[
 'public.revoke_cloud_model_consent_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)',
 'public.revoke_own_copilot_with_nonce_v1(uuid,uuid,uuid,jsonb,text,timestamptz)']) f;
select ok(not has_function_privilege(r,f,'execute'),r||' may not call '||f) from unnest(array['anon','authenticated','inherit_upload_only']) r,
 unnest(array['public.revoke_cloud_model_consent_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)',
  'public.revoke_own_copilot_with_nonce_v1(uuid,uuid,uuid,jsonb,text,timestamptz)']) f;
select is((select proacl::text from pg_proc where oid=f::regprocedure),'{postgres=X/postgres,service_role=X/postgres}',
 f||'''s ACL is exactly owner and service role') from unnest(array[
 'public.revoke_cloud_model_consent_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)',
 'public.revoke_own_copilot_with_nonce_v1(uuid,uuid,uuid,jsonb,text,timestamptz)']) f;
select ok((select bool_and(md5(pg_get_functiondef(p.oid))=x.m) from pg_proc p join (values
  ('public.revoke_cloud_model_consent(uuid,uuid)','40b1b49d088437b24878601795a2a2e0'),
  ('public.revoke_own_copilot_v1(uuid,uuid,uuid,jsonb)','931fc94abdcb0840ff7a202404c9c4fc'))x(s,m) on p.oid=x.s::regprocedure),
 'both revocation writers are unchanged');

select * from finish();
rollback;
