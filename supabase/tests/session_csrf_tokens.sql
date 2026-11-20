begin;
select plan(30);
-- The one-time X-Inherit-CSRF token's spend (migration
-- 20261024220000_session_csrf_tokens; owner decision 2026-10-23, "CSRF: build
-- the token everywhere"). Synthetic accounts, sessions and hashes only.
-- Everything rolls back.

set local request.jwt.claims to '{"role":"service_role"}';

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('session-csrf-test:'||p,'sha256'),'hex') $$;
create function pg_temp.spend(p_route text, p_token text, p_account uuid, p_session uuid,
 p_expires timestamptz default clock_timestamp()+interval '1 hour')
returns boolean language sql volatile as $$
 select public.consume_session_csrf_v1(p_route,'authenticated',pg_temp.h(p_token),p_expires,p_account,p_session)
$$;
create function pg_temp.spend_rights(p_route text, p_token text,
 p_expires timestamptz default clock_timestamp()+interval '1 hour')
returns boolean language sql volatile as $$
 select public.consume_session_csrf_v1(p_route,'token',pg_temp.h(p_token),p_expires,null,null)
$$;

insert into auth.users (id, email, raw_user_meta_data) values
 ('7c000000-0000-4000-8000-000000000001', 'session-csrf-a@example.invalid', '{}'),
 ('7c000000-0000-4000-8000-000000000002', 'session-csrf-b@example.invalid', '{}'),
 ('7c000000-0000-4000-8000-000000000003', 'session-csrf-deleted@example.invalid', '{}');
update auth.users set deleted_at=clock_timestamp() where id='7c000000-0000-4000-8000-000000000003';
insert into auth.sessions (id, user_id, created_at, updated_at, aal, not_after) values
 ('7c000000-0000-4000-8000-000000000011', '7c000000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal1', null),
 ('7c000000-0000-4000-8000-000000000012', '7c000000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal1', null),
 ('7c000000-0000-4000-8000-000000000013', '7c000000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal1',
  clock_timestamp() - interval '1 minute'),
 ('7c000000-0000-4000-8000-000000000021', '7c000000-0000-4000-8000-000000000002', clock_timestamp(), clock_timestamp(), 'aal1', null),
 ('7c000000-0000-4000-8000-000000000031', '7c000000-0000-4000-8000-000000000003', clock_timestamp(), clock_timestamp(), 'aal1', null);

-- ---------------------------------------------------------------------------
-- One spend per token.
select is(pg_temp.spend('api.jurisdiction', 'first', '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000011'),
 true, 'a fresh token of a live session is spent');
select is(pg_temp.spend('api.jurisdiction', 'first', '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000011'),
 false, 'the same token is refused the second time');
select is(pg_temp.spend('api.chat', 'first', '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000011'),
 false, 'a spent token is refused on another route too');
select is(pg_temp.spend('api.jurisdiction', 'second', '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000011'),
 true, 'another token of the same session is its own spend');
select ok((select route_id = 'api.jurisdiction' and expires_at > clock_timestamp() + interval '59 minutes'
 and expires_at <= clock_timestamp() + interval '1 hour'
 from private.session_csrf_token_uses where token_hash = pg_temp.h('first')),
 'a spent token is held by hash, with its route, until it could no longer be fresh');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
 where table_schema = 'private' and table_name = 'session_csrf_token_uses'),
 array['expires_at','route_id','token_hash'], 'the table holds a hash, a route and a time, and nothing that names anyone');

-- ---------------------------------------------------------------------------
-- Bound to the live account session.
select is(pg_temp.spend('api.jurisdiction', 'other-account', '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000021'),
 false, 'a session of another account is refused');
select is(pg_temp.spend('api.jurisdiction', 'unknown-session', '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-0000000000ff'),
 false, 'a session that does not exist is refused');
select is(pg_temp.spend('api.jurisdiction', 'ended-session', '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000013'),
 false, 'a session past its not_after is refused');
select is(pg_temp.spend('api.jurisdiction', 'deleted-user', '7c000000-0000-4000-8000-000000000003', '7c000000-0000-4000-8000-000000000031'),
 false, 'a deleted user''s session is refused');
select is((select count(*) from private.session_csrf_token_uses where token_hash in
 (pg_temp.h('other-account'), pg_temp.h('unknown-session'), pg_temp.h('ended-session'), pg_temp.h('deleted-user'))), 0::bigint,
 'a refused token is not spent');
select is(pg_temp.spend('api.jurisdiction', 'second-session', '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000012'),
 true, 'the account''s other live session spends its own token');
delete from auth.sessions where id = '7c000000-0000-4000-8000-000000000012';
select is(pg_temp.spend('api.jurisdiction', 'after-sign-out', '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000012'),
 false, 'after sign-out removes the session, its tokens are refused');

-- ---------------------------------------------------------------------------
-- Expiry.
select is(pg_temp.spend('api.jurisdiction', 'past', '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000011',
 clock_timestamp() - interval '1 second'), false, 'an expired token is refused');
select is(pg_temp.spend('api.jurisdiction', 'too-far', '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000011',
 clock_timestamp() + interval '13 hours'), false, 'an expiry beyond the twelve-hour lifetime is refused');
select is((select count(*) from private.session_csrf_token_uses where token_hash in (pg_temp.h('past'), pg_temp.h('too-far'))), 0::bigint,
 'neither is recorded');
insert into private.session_csrf_token_uses(token_hash, route_id, expires_at)
 values (pg_temp.h('stale'), 'api.chat', clock_timestamp() - interval '1 minute');
select is(pg_temp.spend('api.jurisdiction', 'sweeps', '7c000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000011'),
 true, 'a spend after a hash expired');
select ok(not exists (select 1 from private.session_csrf_token_uses where token_hash = pg_temp.h('stale'))
 and exists (select 1 from private.session_csrf_token_uses where token_hash = pg_temp.h('first')),
 'removes the expired hash and keeps the live ones');

-- ---------------------------------------------------------------------------
-- A purpose session: the route has already resolved the cookie; the hash is spent once.
select is(pg_temp.spend_rights('api.withdraw', 'rights'), true, 'a rights-session token is spent');
select is(pg_temp.spend_rights('api.withdraw', 'rights'), false, 'and refused the second time');

-- ---------------------------------------------------------------------------
-- Shape.
select throws_ok($$select public.consume_session_csrf_v1('api.chat','authenticated','plain',clock_timestamp()+interval '1 hour',
 '7c000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000011')$$, '22023', 'session csrf request invalid',
 'a token is accepted only as its hash');
select throws_ok($$select public.consume_session_csrf_v1('api.chat','account',pg_temp.h('kind'),clock_timestamp()+interval '1 hour',
 '7c000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000011')$$, '22023', 'session csrf request invalid',
 'an unknown session kind is refused');
select throws_ok($$select public.consume_session_csrf_v1('api.chat','authenticated',pg_temp.h('no-session'),clock_timestamp()+interval '1 hour',
 '7c000000-0000-4000-8000-000000000001',null)$$, '22023', 'session csrf request invalid',
 'an authenticated token names its session');
select throws_ok($$select public.consume_session_csrf_v1('api.withdraw','token',pg_temp.h('with-account'),clock_timestamp()+interval '1 hour',
 '7c000000-0000-4000-8000-000000000001',null)$$, '22023', 'session csrf request invalid',
 'a purpose-session token names no account');
select throws_ok($$select public.consume_session_csrf_v1('settings.page','token',pg_temp.h('route'),clock_timestamp()+interval '1 hour',null,null)$$,
 '22023', 'session csrf request invalid', 'only an endpoint route id is recorded');

-- ---------------------------------------------------------------------------
-- Who may call, and who may read.
set local request.jwt.claims to '{"role":"authenticated"}';
select throws_ok($$select pg_temp.spend_rights('api.withdraw', 'jwt')$$, '42501', 'not_found',
 'the definer body refuses any caller but the service role');
set local request.jwt.claims to '{"role":"service_role"}';
select ok(not has_function_privilege('anon', 'public.consume_session_csrf_v1(text,text,text,timestamptz,uuid,uuid)', 'execute')
 and not has_function_privilege('authenticated', 'public.consume_session_csrf_v1(text,text,text,timestamptz,uuid,uuid)', 'execute')
 and not has_function_privilege('inherit_upload_only', 'public.consume_session_csrf_v1(text,text,text,timestamptz,uuid,uuid)', 'execute'),
 'no client role can call it');
select ok(has_function_privilege('service_role', 'public.consume_session_csrf_v1(text,text,text,timestamptz,uuid,uuid)', 'execute'),
 'the service role reaches the one door');
select ok(not has_table_privilege('service_role', 'private.session_csrf_token_uses', 'select')
 and not has_table_privilege('service_role', 'private.session_csrf_token_uses', 'insert')
 and not has_table_privilege('authenticated', 'private.session_csrf_token_uses', 'select')
 and not has_table_privilege('anon', 'private.session_csrf_token_uses', 'select'),
 'nobody but the definer body reads or writes a spent hash');
select ok((select c.relrowsecurity and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
 from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'private' and c.relname = 'session_csrf_token_uses'),
 'row-level security is on and no policy opens the table');

select * from finish();
rollback;
