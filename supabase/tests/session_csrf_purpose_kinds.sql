begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(58);
-- public.consume_session_csrf_v2 (20261119120000_session_csrf_purpose_kinds;
-- G8.5, the migration stage): the one-time X-Inherit-CSRF token's spend for
-- the reviewer, upload-session, evidence-session, claim-session and
-- reset-session kinds, each held to its session's live row, and the three
-- earlier kinds with v1's rules. Synthetic accounts, sessions, cookie hashes
-- and rows only; the session rows are written with triggers and foreign keys
-- off (session_replication_role=replica), every CHECK still applying.
-- Everything rolls back.

set local request.jwt.claims to '{"role":"service_role"}';

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('session-csrf-v2-test:'||p,'sha256'),'hex') $$;
create function pg_temp.spend(p_kind text, p_route text, p_token text, p_account uuid default null, p_session uuid default null,
 p_cookie text default null, p_purpose uuid default null, p_expires timestamptz default clock_timestamp()+interval '1 hour')
returns boolean language sql volatile as $$
 select public.consume_session_csrf_v2(p_route,p_kind,pg_temp.h(p_token),p_expires,p_account,p_session,
  case when p_cookie is null then null else pg_temp.h(p_cookie) end,p_purpose)
$$;
create function pg_temp.v1(p_kind text, p_route text, p_token text, p_account uuid default null, p_session uuid default null)
returns boolean language sql volatile as $$
 select public.consume_session_csrf_v1(p_route,p_kind,pg_temp.h(p_token),clock_timestamp()+interval '1 hour',p_account,p_session)
$$;

insert into auth.users (id, email, raw_user_meta_data) values
 ('7e000000-0000-4000-8000-000000000001', 'session-csrf-v2-a@example.invalid', '{}'),
 ('7e000000-0000-4000-8000-000000000002', 'session-csrf-v2-deleted@example.invalid', '{}'),
 ('7e000000-0000-4000-8000-000000000003', 'session-csrf-v2-expired-reset@example.invalid', '{}');
update auth.users set deleted_at=clock_timestamp() where id='7e000000-0000-4000-8000-000000000002';
insert into auth.sessions (id, user_id, created_at, updated_at, aal, not_after) values
 ('7e000000-0000-4000-8000-000000000011', '7e000000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal2', null),
 ('7e000000-0000-4000-8000-000000000012', '7e000000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal2',
  clock_timestamp() - interval '1 minute'),
 ('7e000000-0000-4000-8000-000000000021', '7e000000-0000-4000-8000-000000000002', clock_timestamp(), clock_timestamp(), 'aal2', null);

set local session_replication_role=replica;
-- Four embryo upload sessions: open, waiting for a mapping decision, failure-pending and completed.
insert into public.embryo_ingest_sessions (id, cohort_id, originating_session_id, uploader_principal_id, basis_case, basis_revision,
 participant_set_revision, donor_attribution_revision, source_binding_fingerprint, expires_at, cookie_hash, status, failure_code)
select ('7e000000-0000-4000-8000-0000000001'||n)::uuid, gen_random_uuid(), '7e000000-0000-4000-8000-000000000011', gen_random_uuid(),
 'synthetic', 1, 1, 1, repeat('a', 64), clock_timestamp() + interval '1 hour', pg_temp.h('ingest-'||n), s, f
from (values ('01','open',null),('02','mapping_required',null),('03','failure_pending','expiry'),('04','failed','expiry'))
 as v(n, s, f);
-- One evidence session in each of the three tables, and a second claim one, failed.
insert into private.claim_document_sessions (id, intake_id, document_kind, media_type, declared_bytes, declared_sha256,
 cookie_hash, create_nonce_hash, expires_at, state, failure_code, document_key_shredded_at) values
 ('7e000000-0000-4000-8000-000000000201', gen_random_uuid(), 'future-photo-identity', 'application/pdf', 1, repeat('b', 64),
  pg_temp.h('evidence-claim'), pg_temp.h('create-1'), clock_timestamp() + interval '1 hour', 'open', null, clock_timestamp()),
 ('7e000000-0000-4000-8000-000000000202', gen_random_uuid(), 'future-photo-identity', 'application/pdf', 1, repeat('b', 64),
  pg_temp.h('evidence-failed'), pg_temp.h('create-2'), clock_timestamp() + interval '1 hour', 'failed', 'integrity', clock_timestamp());
insert into private.appeal_document_sessions (id, intake_id, evidence_revision, document_kind, media_type, declared_bytes,
 declared_sha256, cookie_hash, create_nonce_hash, expires_at, document_key_shredded_at) values
 ('7e000000-0000-4000-8000-000000000203', gen_random_uuid(), 1, 'appeal-photo-identity', 'application/pdf', 1, repeat('b', 64),
  pg_temp.h('evidence-appeal'), pg_temp.h('create-3'), clock_timestamp() + interval '1 hour', clock_timestamp());
insert into private.permission_document_sessions (id, subject_id, owner_account_id, uploader_principal_id, uploader_consent_id,
 auth_session_id, account_revision, auth_session_revision, jurisdiction_revision, document_kind, media_type, declared_bytes,
 declared_sha256, cookie_hash, create_nonce_hash, expires_at, document_key_shredded_at) values
 ('7e000000-0000-4000-8000-000000000204', gen_random_uuid(), '7e000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(),
  '7e000000-0000-4000-8000-000000000011', 1, 1, 1, 'adult-signed-permission', 'application/pdf', 1, repeat('b', 64),
  pg_temp.h('evidence-permission'), pg_temp.h('create-4'), clock_timestamp() + interval '1 hour', clock_timestamp());
-- Four claim sessions: live, completed, idle past 30 minutes and expired.
insert into private.future_person_claim_intakes (session_hash, form_nonce_hash, mode, identity_ciphertext, wrapped_data_key,
 identifier_hmac, identifier_key_revision, network_hmac, network_key_revision, created_at, last_active_at, expires_at, completed_at)
select pg_temp.h('claim-'||n), pg_temp.h('form-'||n), 'keyless-start', decode(repeat('00', 29), 'hex'), decode(repeat('00', 29), 'hex'),
 repeat('c', 64), 1, repeat('d', 64), 1, created, active, created + interval '24 hours', completed
from (values
 ('live', clock_timestamp() - interval '1 hour', clock_timestamp() - interval '1 minute', null::timestamptz),
 ('completed', clock_timestamp() - interval '1 hour', clock_timestamp() - interval '1 minute', clock_timestamp()),
 ('idle', clock_timestamp() - interval '2 hours', clock_timestamp() - interval '31 minutes', null),
 ('expired', clock_timestamp() - interval '25 hours', clock_timestamp() - interval '24 hours 30 minutes', null)
) as v(n, created, active, completed);
-- Three reset sessions: live, expired, and one of a deleted account.
insert into private.auth_recovery_sessions (session_hash, account_id, origin_session_id, issued_at, expires_at) values
 (pg_temp.h('reset-live'), '7e000000-0000-4000-8000-000000000001', gen_random_uuid(), clock_timestamp(), clock_timestamp() + interval '10 minutes'),
 (pg_temp.h('reset-expired'), '7e000000-0000-4000-8000-000000000003', gen_random_uuid(), clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '10 minutes'),
 (pg_temp.h('reset-deleted'), '7e000000-0000-4000-8000-000000000002', gen_random_uuid(), clock_timestamp(), clock_timestamp() + interval '10 minutes');
set local session_replication_role=origin;

-- ---------------------------------------------------------------------------
-- reviewer: the account and its live auth session, under its own kind.
select is(pg_temp.spend('reviewer', 'api.appeal-review', 'reviewer-1', '7e000000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000011'),
 true, 'a reviewer token of a live auth session is spent');
select is(pg_temp.spend('reviewer', 'api.appeal-review', 'reviewer-1', '7e000000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000011'),
 false, 'and refused the second time');
select is(pg_temp.spend('reviewer', 'api.appeal-review', 'reviewer-ended', '7e000000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000012'),
 false, 'a reviewer token of an auth session past its not_after is refused');
select is(pg_temp.spend('reviewer', 'api.appeal-review', 'reviewer-deleted', '7e000000-0000-4000-8000-000000000002', '7e000000-0000-4000-8000-000000000021'),
 false, 'a deleted reviewer''s token is refused');
select is(pg_temp.spend('reviewer', 'api.appeal-review', 'reviewer-foreign', '7e000000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000021'),
 false, 'another account''s auth session is refused');
delete from auth.sessions where id='7e000000-0000-4000-8000-000000000011';
select is(pg_temp.spend('reviewer', 'api.appeal-review', 'reviewer-after-sign-out', '7e000000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000011'),
 false, 'after sign-out removes the auth session, its reviewer tokens are refused');
insert into auth.sessions (id, user_id, created_at, updated_at, aal, not_after) values
 ('7e000000-0000-4000-8000-000000000011', '7e000000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal2', null);

-- ---------------------------------------------------------------------------
-- upload-session: the ingest session of that id and cookie, while its route can still answer it.
select is(pg_temp.spend('upload-session', 'api.embryo-ingest-configure', 'ingest-1', p_cookie => 'ingest-01',
 p_purpose => '7e000000-0000-4000-8000-000000000101'), true, 'an open upload session''s token is spent');
select is(pg_temp.spend('upload-session', 'api.embryo-ingest-configure', 'ingest-1', p_cookie => 'ingest-01',
 p_purpose => '7e000000-0000-4000-8000-000000000101'), false, 'and refused the second time');
select is(pg_temp.spend('upload-session', 'api.embryo-ingest-mapping', 'ingest-2', p_cookie => 'ingest-02',
 p_purpose => '7e000000-0000-4000-8000-000000000102'), true, 'a session waiting for a mapping decision is open');
select is(pg_temp.spend('upload-session', 'api.embryo-ingest-complete', 'ingest-3', p_cookie => 'ingest-03',
 p_purpose => '7e000000-0000-4000-8000-000000000103'), true,
 'a failure-pending session is admitted, so its route dispatches the unwind before its 404');
select is(pg_temp.spend('upload-session', 'api.embryo-ingest-complete', 'ingest-4', p_cookie => 'ingest-04',
 p_purpose => '7e000000-0000-4000-8000-000000000104'), false, 'a failed session''s token is refused');
select is(pg_temp.spend('upload-session', 'api.embryo-ingest-complete', 'ingest-wrong-cookie', p_cookie => 'ingest-02',
 p_purpose => '7e000000-0000-4000-8000-000000000101'), false, 'another session''s cookie is refused');
select is(pg_temp.spend('upload-session', 'api.embryo-ingest-complete', 'ingest-unknown', p_cookie => 'ingest-01',
 p_purpose => '7e000000-0000-4000-8000-0000000001ff'), false, 'a session that does not exist is refused');
set local session_replication_role=replica;
update public.embryo_ingest_sessions set status='sanitization_pending', completed_at=clock_timestamp(),
 manifest_sha256=repeat('e', 64), manifest_chunk_count=1, completion_nonce_hash=repeat('f', 64), worker_job_id=gen_random_uuid()
 where id='7e000000-0000-4000-8000-000000000102';
set local session_replication_role=origin;
select is(pg_temp.spend('upload-session', 'api.embryo-ingest-mapping', 'ingest-after-complete', p_cookie => 'ingest-02',
 p_purpose => '7e000000-0000-4000-8000-000000000102'), false, 'once the session is completed, its tokens are refused');

-- ---------------------------------------------------------------------------
-- evidence-session: a document session row of that id and cookie, in any of the three tables.
select is(pg_temp.spend('evidence-session', 'api.evidence-complete', 'evidence-1', p_cookie => 'evidence-claim',
 p_purpose => '7e000000-0000-4000-8000-000000000201'), true, 'a claim document session''s token is spent');
select is(pg_temp.spend('evidence-session', 'api.evidence-complete', 'evidence-1', p_cookie => 'evidence-claim',
 p_purpose => '7e000000-0000-4000-8000-000000000201'), false, 'and refused the second time');
select is(pg_temp.spend('evidence-session', 'api.evidence-complete', 'evidence-2', p_cookie => 'evidence-appeal',
 p_purpose => '7e000000-0000-4000-8000-000000000203'), true, 'an appeal document session''s token is spent');
select is(pg_temp.spend('evidence-session', 'api.evidence-complete', 'evidence-3', p_cookie => 'evidence-permission',
 p_purpose => '7e000000-0000-4000-8000-000000000204'), true, 'a permission document session''s token is spent');
select is(pg_temp.spend('evidence-session', 'api.evidence-complete', 'evidence-4', p_cookie => 'evidence-failed',
 p_purpose => '7e000000-0000-4000-8000-000000000202'), true,
 'a failed session''s completion may still ask for its refusal reason');
select is(pg_temp.spend('evidence-session', 'api.evidence-complete', 'evidence-cross', p_cookie => 'evidence-appeal',
 p_purpose => '7e000000-0000-4000-8000-000000000201'), false, 'another session''s cookie is refused');
set local session_replication_role=replica;
delete from private.appeal_document_sessions where id='7e000000-0000-4000-8000-000000000203';
set local session_replication_role=origin;
select is(pg_temp.spend('evidence-session', 'api.evidence-complete', 'evidence-after-delete', p_cookie => 'evidence-appeal',
 p_purpose => '7e000000-0000-4000-8000-000000000203'), false, 'once the session''s row is gone, its tokens are refused');

-- ---------------------------------------------------------------------------
-- claim-session: the claim of that cookie hash, while it is live.
select is(pg_temp.spend('claim-session', 'api.future-person-claim-document-session', 'claim-1', p_cookie => 'claim-live'),
 true, 'a live claim session''s token is spent');
select is(pg_temp.spend('claim-session', 'api.future-person-claim-document-session', 'claim-1', p_cookie => 'claim-live'),
 false, 'and refused the second time');
select is(pg_temp.spend('claim-session', 'api.future-person-claim-complete', 'claim-2', p_cookie => 'claim-completed'),
 false, 'a completed claim''s token is refused');
select is(pg_temp.spend('claim-session', 'api.future-person-claim-complete', 'claim-3', p_cookie => 'claim-idle'),
 false, 'a claim idle past thirty minutes is refused');
select is(pg_temp.spend('claim-session', 'api.future-person-claim-complete', 'claim-4', p_cookie => 'claim-expired'),
 false, 'an expired claim''s token is refused');
update private.future_person_claim_intakes set session_hash=pg_temp.h('claim-rotated') where session_hash=pg_temp.h('claim-live');
select is(pg_temp.spend('claim-session', 'api.future-person-claim-complete', 'claim-5', p_cookie => 'claim-live'),
 false, 'after the cookie rotates, a token of the old cookie is refused');
select is(pg_temp.spend('claim-session', 'api.future-person-claim-complete', 'claim-6', p_cookie => 'claim-rotated'),
 true, 'and the new cookie''s token is spent');

-- ---------------------------------------------------------------------------
-- reset-session: the reset session of that cookie hash, unexpired, of an account not deleted.
select is(pg_temp.spend('reset-session', 'auth.reset-password-submit', 'reset-1', p_cookie => 'reset-live'),
 true, 'a live reset session''s token is spent');
select is(pg_temp.spend('reset-session', 'auth.reset-password-submit', 'reset-1', p_cookie => 'reset-live'),
 false, 'and refused the second time');
select is(pg_temp.spend('reset-session', 'auth.reset-password-submit', 'reset-2', p_cookie => 'reset-expired'),
 false, 'an expired reset session''s token is refused');
select is(pg_temp.spend('reset-session', 'auth.reset-password-submit', 'reset-3', p_cookie => 'reset-deleted'),
 false, 'a deleted account''s reset session is refused');
delete from private.auth_recovery_sessions where session_hash=pg_temp.h('reset-live');
select is(pg_temp.spend('reset-session', 'auth.reset-password-submit', 'reset-4', p_cookie => 'reset-live'),
 false, 'once the reset spends the session, its tokens are refused');

select is((select count(*) from private.session_csrf_token_uses where token_hash in (pg_temp.h('reviewer-ended'),
 pg_temp.h('ingest-4'), pg_temp.h('evidence-cross'), pg_temp.h('claim-2'), pg_temp.h('reset-2'))), 0::bigint,
 'a refused token is not spent');

-- ---------------------------------------------------------------------------
-- The three earlier kinds, with v1's rules; and one spend across both doors.
select is(pg_temp.spend('authenticated', 'api.jurisdiction', 'account-1', '7e000000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000011'),
 true, 'an authenticated token is spent as v1 spends it');
select is(pg_temp.spend('authenticated', 'api.jurisdiction', 'account-2', '7e000000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000012'),
 false, 'and refused for an ended auth session as v1 refuses it');
select is(pg_temp.spend('token', 'api.withdraw', 'rights-1'), true, 'a rights token is spent as v1 spends it');
select is(pg_temp.spend('token-candidate', 'api.rights-activate', 'candidate-1'), true, 'a candidate token is spent as v1 spends it');
select is(pg_temp.v1('token', 'api.withdraw', 'rights-1'), false, 'a hash spent through v2 is refused by v1');
select is(pg_temp.v1('token', 'api.withdraw', 'rights-2'), true, 'v1 spends a hash of its own');
select is(pg_temp.spend('token', 'api.withdraw', 'rights-2'), false, 'a hash spent through v1 is refused by v2');
select throws_ok($$select public.consume_session_csrf_v1('api.appeal-review','reviewer',pg_temp.h('v1-new-kind'),
 clock_timestamp()+interval '1 hour','7e000000-0000-4000-8000-000000000001','7e000000-0000-4000-8000-000000000011')$$,
 '22023', 'session csrf request invalid', 'v1 still refuses every later kind');

-- ---------------------------------------------------------------------------
-- Expiry, and the shapes each kind must carry.
select is(pg_temp.spend('claim-session', 'api.future-person-claim-complete', 'expired', p_cookie => 'claim-rotated',
 p_expires => clock_timestamp() - interval '1 second'), false, 'an expired token is refused');
select is(pg_temp.spend('claim-session', 'api.future-person-claim-complete', 'too-far', p_cookie => 'claim-rotated',
 p_expires => clock_timestamp() + interval '13 hours'), false, 'an expiry beyond the twelve-hour lifetime is refused');
select throws_ok($$select pg_temp.spend('reviewer','api.appeal-review','no-session','7e000000-0000-4000-8000-000000000001',null)$$,
 '22023', 'session csrf request invalid', 'a reviewer token names its auth session');
select throws_ok($$select pg_temp.spend('reviewer','api.appeal-review','with-cookie','7e000000-0000-4000-8000-000000000001',
 '7e000000-0000-4000-8000-000000000011','claim-live')$$, '22023', 'session csrf request invalid', 'a reviewer token names no cookie');
select throws_ok($$select pg_temp.spend('claim-session','api.future-person-claim-complete','no-cookie')$$,
 '22023', 'session csrf request invalid', 'a claim-session token names its cookie');
select throws_ok($$select pg_temp.spend('claim-session','api.future-person-claim-complete','with-account',
 '7e000000-0000-4000-8000-000000000001','7e000000-0000-4000-8000-000000000011','claim-live')$$,
 '22023', 'session csrf request invalid', 'a claim-session token names no account');
select throws_ok($$select pg_temp.spend('claim-session','api.future-person-claim-complete','with-purpose',p_cookie=>'claim-live',
 p_purpose=>'7e000000-0000-4000-8000-000000000101')$$, '22023', 'session csrf request invalid', 'a claim-session token names no session id');
select throws_ok($$select pg_temp.spend('upload-session','api.embryo-ingest-complete','no-purpose',p_cookie=>'ingest-01')$$,
 '22023', 'session csrf request invalid', 'an upload-session token names its session id');
select throws_ok($$select public.consume_session_csrf_v2('api.evidence-complete','evidence-session',pg_temp.h('raw-cookie'),
 clock_timestamp()+interval '1 hour',null,null,'not-a-hash','7e000000-0000-4000-8000-000000000201')$$,
 '22023', 'session csrf request invalid', 'a cookie is accepted only as its hash');
select throws_ok($$select pg_temp.spend('token','api.withdraw','rights-cookie',p_cookie=>'claim-live')$$,
 '22023', 'session csrf request invalid', 'a rights token names no cookie, as in v1');
select throws_ok($$select pg_temp.spend('download-session','api.download-chunk','download',p_cookie=>'claim-live')$$,
 '22023', 'session csrf request invalid', 'an unknown session kind is refused');

-- ---------------------------------------------------------------------------
-- Who may call, and what the function is.
set local request.jwt.claims to '{"role":"authenticated"}';
select throws_ok($$select pg_temp.spend('token','api.withdraw','jwt')$$, '42501', 'not_found',
 'the definer body refuses any caller but the service role');
set local request.jwt.claims to '{"role":"service_role"}';
select ok(not has_function_privilege('anon', 'public.consume_session_csrf_v2(text,text,text,timestamptz,uuid,uuid,text,uuid)', 'execute')
 and not has_function_privilege('authenticated', 'public.consume_session_csrf_v2(text,text,text,timestamptz,uuid,uuid,text,uuid)', 'execute')
 and not has_function_privilege('inherit_upload_only', 'public.consume_session_csrf_v2(text,text,text,timestamptz,uuid,uuid,text,uuid)', 'execute'),
 'no client role can call it');
select ok(has_function_privilege('service_role', 'public.consume_session_csrf_v2(text,text,text,timestamptz,uuid,uuid,text,uuid)', 'execute'),
 'the service role reaches the one door');
select is((select md5(pg_get_functiondef(p.oid))||' '||p.proacl::text from pg_proc p
 where p.oid='public.consume_session_csrf_v2(text,text,text,timestamptz,uuid,uuid,text,uuid)'::regprocedure),
 '13570c4a4b77de1fbc6e3fcfe2d40636 {postgres=X/postgres,service_role=X/postgres}', 'the body and its ACL are the reviewed ones');
select is((select md5(pg_get_functiondef(p.oid))||' '||p.proacl::text from pg_proc p
 where p.oid='public.consume_session_csrf_v1(text,text,text,timestamptz,uuid,uuid)'::regprocedure),
 'ae9a75327090d06a46456efce17625a3 {postgres=X/postgres,service_role=X/postgres}', 'v1 is unchanged');

select * from finish();
rollback;
