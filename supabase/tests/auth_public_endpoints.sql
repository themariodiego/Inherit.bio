begin;
select plan(55);
-- auth.sign-up-submit, auth.forgot-password-submit and auth.reset-password-submit
-- (migration 20261016151200_auth_public_endpoints; owner decision 2026-10-16).
-- Synthetic digests and accounts only: the database never sees an address,
-- a network or a password. Everything rolls back.

set local request.jwt.claims to '{"role":"service_role"}';
delete from public.rate_limit_hmac_buckets where action_id in ('auth.sign-up-submit', 'auth.forgot-password-submit');
delete from private.auth_form_nonces;
delete from private.auth_recovery_sessions;

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('auth-endpoints-test:'||p,'sha256'),'hex') $$;
create function pg_temp.set1(p text) returns jsonb language sql immutable as
 $$ select jsonb_build_object('1', pg_temp.h(p)) $$;
create function pg_temp.admit(p_route text, p_email text, p_network text, p_nonce text default null)
returns text language sql volatile as $$
 select public.admit_auth_public_request_v1(p_route,
  pg_temp.h('nonce:'||coalesce(p_nonce, gen_random_uuid()::text)),
  pg_temp.set1('email:'||p_email), pg_temp.set1('network:'||p_network))
$$;

-- ---------------------------------------------------------------------------
-- The one-time form nonce.
select is(pg_temp.admit('auth.sign-up-submit', 'a@x', 'n1', 'first'), 'admitted', 'a fresh sign-up form is admitted');
select is(pg_temp.admit('auth.sign-up-submit', 'b@x', 'n2', 'first'), 'replayed', 'the same form nonce is spent once');
select is(pg_temp.admit('auth.forgot-password-submit', 'b@x', 'n2', 'first'), 'replayed',
  'a nonce spent on one auth form cannot be spent on the other');
select ok((select route_id = 'auth.sign-up-submit'
   and expires_at > clock_timestamp() + interval '9 minutes'
   and expires_at <= clock_timestamp() + interval '10 minutes'
  from private.auth_form_nonces where nonce_hash = pg_temp.h('nonce:first')),
  'a spent nonce is held by hash for the ten-minute token lifetime and no longer');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
  where table_schema = 'private' and table_name = 'auth_form_nonces'),
  array['expires_at','nonce_hash','route_id'], 'the nonce table holds a hash, a route and a time');

-- Refusals of shape.
select throws_ok($$select public.admit_auth_public_request_v1('auth.sign-in', pg_temp.h('x'), pg_temp.set1('e'), pg_temp.set1('n'))$$,
  '22023', 'auth request invalid', 'only the two public auth forms are counted here');
select throws_ok($$select public.admit_auth_public_request_v1('auth.sign-up-submit', 'plain-nonce', pg_temp.set1('e'), pg_temp.set1('n'))$$,
  '22023', 'auth request invalid', 'a nonce is accepted only as its hash');
select throws_ok($$select public.admit_auth_public_request_v1('auth.sign-up-submit', pg_temp.h('x1'), null, pg_temp.set1('n'))$$,
  '55000', 'rate limit keys required', 'a request without its email digest is refused');
select throws_ok($$select public.admit_auth_public_request_v1('auth.sign-up-submit', pg_temp.h('x2'), pg_temp.set1('e'), null)$$,
  '55000', 'rate limit keys required', 'a request without its network digest is refused');
select throws_ok($$select public.admit_auth_public_request_v1('auth.sign-up-submit', pg_temp.h('x3'), pg_temp.set1('e'),
  jsonb_build_object('1', '192.0.2.1'))$$,
  '22023', 'keyed digest set invalid', 'a raw network address is not a digest');
select throws_ok($$select public.admit_auth_public_request_v1('auth.sign-up-submit', pg_temp.h('x4'),
  jsonb_build_object('1', 'person@example.invalid'), pg_temp.set1('n'))$$,
  '22023', 'keyed digest set invalid', 'a raw address is not a digest');
select is((select count(*) from private.auth_form_nonces where nonce_hash in
  (pg_temp.h('x1'), pg_temp.h('x2'), pg_temp.h('x3'), pg_temp.h('x4'))), 0::bigint,
  'a refused request spends no nonce');

-- ---------------------------------------------------------------------------
-- Sign-up: 5 an hour per normalized email.
select is(pg_temp.admit('auth.sign-up-submit', 'five@x', 'e1'), 'admitted', 'sign-up 1 for one email');
select is(pg_temp.admit('auth.sign-up-submit', 'five@x', 'e2'), 'admitted', 'sign-up 2');
select is(pg_temp.admit('auth.sign-up-submit', 'five@x', 'e3'), 'admitted', 'sign-up 3');
select is(pg_temp.admit('auth.sign-up-submit', 'five@x', 'e4'), 'admitted', 'sign-up 4');
select is(pg_temp.admit('auth.sign-up-submit', 'five@x', 'e5'), 'admitted', 'sign-up 5');
select is(pg_temp.admit('auth.sign-up-submit', 'five@x', 'e6', 'limited-signup'), 'limited',
  'a sixth sign-up for one email within the hour is limited');
select is(pg_temp.admit('auth.sign-up-submit', 'other@x', 'e6', 'limited-signup'), 'replayed',
  'a limited request still spends its form nonce');
select is(pg_temp.admit('auth.forgot-password-submit', 'five@x', 'e7'), 'admitted',
  'the sign-up limit does not count against the same email''s forgot-password requests');

-- Sign-up: 20 an hour per source network.
select is((select count(*) from generate_series(1, 20) g
  where pg_temp.admit('auth.sign-up-submit', 'net'||g||'@x', 'busy') = 'admitted'), 20::bigint,
  'twenty sign-ups from one network within the hour are admitted');
select is(pg_temp.admit('auth.sign-up-submit', 'net21@x', 'busy'), 'limited',
  'the twenty-first sign-up from one network within the hour is limited');

-- Forgot password: 3 an hour per email, 10 an hour per network.
select is((select count(*) from generate_series(1, 3) g
  where pg_temp.admit('auth.forgot-password-submit', 'three@x', 'f'||g) = 'admitted'), 3::bigint,
  'three reset requests for one email within the hour are admitted');
select is(pg_temp.admit('auth.forgot-password-submit', 'three@x', 'f4'), 'limited',
  'a fourth reset request for one email within the hour is limited');
select is((select count(*) from generate_series(1, 10) g
  where pg_temp.admit('auth.forgot-password-submit', 'fnet'||g||'@x', 'fbusy') = 'admitted'), 10::bigint,
  'ten reset requests from one network within the hour are admitted');
select is(pg_temp.admit('auth.forgot-password-submit', 'fnet11@x', 'fbusy'), 'limited',
  'the eleventh reset request from one network within the hour is limited');

-- What the buckets hold.
select is((select array_agg(distinct dimension||':'||window_seconds||':'||limit_count order by dimension||':'||window_seconds||':'||limit_count)
  from public.rate_limit_hmac_buckets where action_id = 'auth.sign-up-submit'),
  array['normalized-identifier:3600:5', 'source-network:3600:20'], 'sign-up counts 5 per email and 20 per network, by the hour');
select is((select array_agg(distinct dimension||':'||window_seconds||':'||limit_count order by dimension||':'||window_seconds||':'||limit_count)
  from public.rate_limit_hmac_buckets where action_id = 'auth.forgot-password-submit'),
  array['normalized-identifier:3600:3', 'source-network:3600:10'], 'forgot-password counts 3 per email and 10 per network, by the hour');
select ok(not exists (select 1 from public.rate_limit_hmac_buckets
  where action_id in ('auth.sign-up-submit', 'auth.forgot-password-submit')
    and (bucket_key_hmac !~ '^[0-9a-f]{64}$' or expires_at > first_attempt_at + interval '24 hours')),
  'every bucket is a keyed digest purged within 24 hours');

-- Who may call.
set local request.jwt.claims to '{"role":"authenticated"}';
select throws_ok($$select pg_temp.admit('auth.sign-up-submit', 'jwt@x', 'jwt')$$, '42501', 'not_found',
  'the definer body refuses any caller but the service role');
set local request.jwt.claims to '{"role":"service_role"}';
select ok(not has_function_privilege('anon', 'public.admit_auth_public_request_v1(text,text,jsonb,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.admit_auth_public_request_v1(text,text,jsonb,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.issue_auth_recovery_session_v1(text,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.reset_password_with_recovery_v1(text,text)', 'execute')
  and not has_function_privilege('anon', 'public.purge_expired_auth_credentials_v1()', 'execute'),
  'no client role can call any of them');
select ok(has_function_privilege('service_role', 'public.admit_auth_public_request_v1(text,text,jsonb,jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.issue_auth_recovery_session_v1(text,uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.reset_password_with_recovery_v1(text,text)', 'execute')
  and has_function_privilege('service_role', 'public.purge_expired_auth_credentials_v1()', 'execute')
  and not has_function_privilege('service_role', 'private.consume_rate_limit_buckets_v1(text,jsonb,jsonb)', 'execute'),
  'the service role reaches the four doors and still cannot write a bucket directly');
select ok(not has_table_privilege('service_role', 'private.auth_form_nonces', 'select')
  and not has_table_privilege('service_role', 'private.auth_recovery_sessions', 'select')
  and not has_table_privilege('authenticated', 'private.auth_recovery_sessions', 'select'),
  'nobody but the definer bodies reads a nonce or a reset session');

-- ---------------------------------------------------------------------------
-- Reset sessions.
insert into auth.users (id, email, raw_user_meta_data) values
 ('7a000000-0000-4000-8000-000000000001', 'auth-reset-test@example.invalid', '{}'),
 ('7a000000-0000-4000-8000-000000000002', 'auth-reset-other@example.invalid', '{}');
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
 ('7a000000-0000-4000-8000-000000000011', '7a000000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal1'),
 ('7a000000-0000-4000-8000-000000000012', '7a000000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal1'),
 ('7a000000-0000-4000-8000-000000000013', '7a000000-0000-4000-8000-000000000001',
  clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '10 minutes', 'aal1'),
 ('7a000000-0000-4000-8000-000000000014', '7a000000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal1'),
 ('7a000000-0000-4000-8000-000000000021', '7a000000-0000-4000-8000-000000000002', clock_timestamp(), clock_timestamp(), 'aal1');
insert into auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method) values
 (gen_random_uuid(), '7a000000-0000-4000-8000-000000000011', clock_timestamp(), clock_timestamp(), 'recovery'),
 (gen_random_uuid(), '7a000000-0000-4000-8000-000000000012', clock_timestamp(), clock_timestamp(), 'password'),
 (gen_random_uuid(), '7a000000-0000-4000-8000-000000000013', clock_timestamp(), clock_timestamp(), 'recovery'),
 (gen_random_uuid(), '7a000000-0000-4000-8000-000000000014', clock_timestamp(), clock_timestamp(), 'recovery'),
 (gen_random_uuid(), '7a000000-0000-4000-8000-000000000021', clock_timestamp(), clock_timestamp(), 'recovery');
create temporary table revision_before as
 select auth_session_revision r from public.profiles where id = '7a000000-0000-4000-8000-000000000001';

select throws_ok($$select public.issue_auth_recovery_session_v1(pg_temp.h('reset:pw'),
  '7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000012')$$, '42501', 'not_found',
  'a password session cannot become a reset session');
select throws_ok($$select public.issue_auth_recovery_session_v1(pg_temp.h('reset:old'),
  '7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000013')$$, '42501', 'not_found',
  'a recovery session minutes past its exchange is refused');
select throws_ok($$select public.issue_auth_recovery_session_v1(pg_temp.h('reset:foreign'),
  '7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000021')$$, '42501', 'not_found',
  'another account''s recovery session is refused');
select throws_ok($$select public.issue_auth_recovery_session_v1(pg_temp.h('reset:nobody'),
  '7a000000-0000-4000-8000-0000000000ff', '7a000000-0000-4000-8000-000000000011')$$, '42501', 'not_found',
  'an unknown account is refused');
select throws_ok($$select public.issue_auth_recovery_session_v1('plain-secret',
  '7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000011')$$, '22023', 'auth recovery invalid',
  'a reset credential is stored only as a hash');

select is(public.issue_auth_recovery_session_v1(pg_temp.h('reset:first'),
  '7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000011'), 'issued',
  'a fresh recovery session of the same account issues a reset session');
select ok((select expires_at = issued_at + interval '15 minutes' from private.auth_recovery_sessions
  where session_hash = pg_temp.h('reset:first')), 'the reset session lives 15 minutes from issuance');
select ok(not exists (select 1 from auth.sessions where id = '7a000000-0000-4000-8000-000000000011')
  and exists (select 1 from auth.sessions where id = '7a000000-0000-4000-8000-000000000012'),
  'issuance revokes the recovery-origin session and nothing else');
select is(public.issue_auth_recovery_session_v1(pg_temp.h('reset:second'),
  '7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000014'), 'issued',
  'a newer link issues a newer reset session');
select is((select array_agg(session_hash) from private.auth_recovery_sessions
  where account_id = '7a000000-0000-4000-8000-000000000001'), array[pg_temp.h('reset:second')],
  'and it replaces the older one');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
  where table_schema = 'private' and table_name = 'auth_recovery_sessions'),
  array['account_id','expires_at','issued_at','origin_session_id','session_hash'],
  'a reset session holds a hash, two ids and two times');

-- The reset transaction.
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
 ('7a000000-0000-4000-8000-000000000015', '7a000000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal1');
select throws_ok($$select public.reset_password_with_recovery_v1(pg_temp.h('reset:first'),
  '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0')$$, '42501', 'not_found',
  'a replaced reset session no longer works');
select throws_ok($$select public.reset_password_with_recovery_v1(pg_temp.h('reset:second'), 'a-plain-password')$$,
  '22023', 'auth reset invalid', 'the database accepts only a bcrypt hash, never a password');
select is(public.reset_password_with_recovery_v1(pg_temp.h('reset:second'),
  '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0'), 'reset', 'the current reset session resets');
select is((select encrypted_password from auth.users where id = '7a000000-0000-4000-8000-000000000001'),
  '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0', 'the new hash is stored');
select is((select count(*) from auth.sessions where user_id = '7a000000-0000-4000-8000-000000000001'), 0::bigint,
  'every session of the account is revoked');
select is((select count(*) from auth.sessions where user_id = '7a000000-0000-4000-8000-000000000002'), 1::bigint,
  'another account''s sessions are untouched');
select is((select auth_session_revision from public.profiles where id = '7a000000-0000-4000-8000-000000000001'),
  (select r + 1 from revision_before), 'the account auth session revision rises by one');
select throws_ok($$select public.reset_password_with_recovery_v1(pg_temp.h('reset:second'),
  '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1')$$, '42501', 'not_found',
  'a reset session works once');

-- Expiry and purge.
insert into private.auth_recovery_sessions (session_hash, account_id, origin_session_id, issued_at, expires_at)
select pg_temp.h('reset:expired'), '7a000000-0000-4000-8000-000000000002'::uuid, gen_random_uuid(),
  t - interval '20 minutes', t - interval '5 minutes' from (select clock_timestamp() t) x;
select throws_ok($$select public.reset_password_with_recovery_v1(pg_temp.h('reset:expired'),
  '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ2')$$, '42501', 'not_found',
  'an expired reset session is refused');
insert into private.auth_form_nonces (nonce_hash, route_id, expires_at)
values (pg_temp.h('nonce:stale'), 'auth.forgot-password-submit', clock_timestamp() - interval '1 second');
select is(public.purge_expired_auth_credentials_v1(), 2, 'the purge removes the expired nonce and reset session');
select ok(not exists (select 1 from private.auth_recovery_sessions where session_hash = pg_temp.h('reset:expired'))
  and not exists (select 1 from private.auth_form_nonces where nonce_hash = pg_temp.h('nonce:stale'))
  and exists (select 1 from private.auth_form_nonces where nonce_hash = pg_temp.h('nonce:first')),
  'and keeps every unexpired nonce');

select * from finish();
rollback;
