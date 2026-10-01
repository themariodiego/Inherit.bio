begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Brief X1.5: an account-deletion nonce is rendered by /settings/data and
-- consumed by the POST; nothing issues or stores one ahead of use.

-- Nothing can store a nonce in advance any more, and the app reaches the
-- operations only through the functions that record the nonce themselves.
select is(to_regprocedure('public.issue_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)'),null,
 'the nonce-issuing function is gone');
select ok(not has_function_privilege('service_role','public.request_account_deletion_v1(uuid,uuid,text,bytea,text,text)','EXECUTE'),
 'the service role cannot reach the v1 request, which consumes only a stored nonce');
select ok(not has_function_privilege('service_role','public.cancel_account_deletion_v1(uuid,uuid,text,text)','EXECUTE'),
 'the service role cannot reach the v1 cancellation');
select ok(has_function_privilege('service_role','public.request_account_deletion_v2(uuid,uuid,text,timestamp with time zone,bytea,text,text)','EXECUTE'),
 'the service role requests deletion through v2');
select ok(has_function_privilege('service_role','public.cancel_account_deletion_v2(uuid,uuid,text,timestamp with time zone,text)','EXECUTE'),
 'the service role cancels through v2');
select ok(not has_function_privilege('authenticated','public.request_account_deletion_v2(uuid,uuid,text,timestamp with time zone,bytea,text,text)','EXECUTE'),
 'a signed-in user cannot call v2 directly');
select ok(not has_function_privilege('authenticated','private.request_account_deletion_v2(uuid,uuid,text,timestamp with time zone,bytea,text,text)','EXECUTE')
 and not has_function_privilege('authenticated','private.cancel_account_deletion_v2(uuid,uuid,text,timestamp with time zone,text)','EXECUTE'),
 'nor its private bodies');
select is((select string_agg(p.oid::regprocedure::text||':'||p.prosecdef,',' order by n.nspname)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='request_account_deletion_v2'),
 'private.request_account_deletion_v2(uuid,uuid,text,timestamp with time zone,bytea,text,text):true,request_account_deletion_v2(uuid,uuid,text,timestamp with time zone,bytea,text,text):false',
 'the public door is an invoker over a private definer body');
select ok(not has_function_privilege('service_role','private.record_account_operation_nonce_v1(uuid,uuid,text,text,timestamp with time zone)','EXECUTE'),
 'the nonce recorder is reachable only through v2');

insert into auth.users(id,email,raw_user_meta_data)
 values('7a300000-0000-4000-8000-000000000001','nonce-rendered@example.invalid','{"display_name":"Nonce rendered"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('7a300000-0000-4000-8000-000000000010','7a300000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp(),'aal1'),
 ('7a300000-0000-4000-8000-000000000011','7a300000-0000-4000-8000-000000000001',
  clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '20 minutes','aal1');


select is((select count(*) from public.account_operation_nonces where account_id='7a300000-0000-4000-8000-000000000001'),
 0::bigint,'nothing is stored before the operation');

-- The expiry bound is the database's own check, beside the route's MAC.
select throws_ok($$select * from public.request_account_deletion_v2('7a300000-0000-4000-8000-000000000001',
 '7a300000-0000-4000-8000-000000000010',repeat('1',64),clock_timestamp()+interval '11 minutes',
 decode('00','hex'),repeat('b',64),repeat('c',64))$$,'22023','invalid_operation_nonce',
 'a nonce that claims to live more than ten minutes is refused');
select throws_ok($$select * from public.request_account_deletion_v2('7a300000-0000-4000-8000-000000000001',
 '7a300000-0000-4000-8000-000000000010',repeat('1',64),clock_timestamp()-interval '1 second',
 decode('00','hex'),repeat('b',64),repeat('c',64))$$,'22023','invalid_operation_nonce',
 'an expired nonce is refused');
select throws_ok($$select * from public.request_account_deletion_v2('7a300000-0000-4000-8000-000000000001',
 '7a300000-0000-4000-8000-000000000011',repeat('1',64),clock_timestamp()+interval '9 minutes',
 decode('00','hex'),repeat('b',64),repeat('c',64))$$,'42501','recent_reauthentication_required',
 'a session older than fifteen minutes cannot spend a nonce');
select is((select count(*) from public.account_operation_nonces where account_id='7a300000-0000-4000-8000-000000000001'),
 0::bigint,'a refused attempt records nothing');

-- The real page saves a millisecond render instant and its exact ten-minute
-- expiry before the POST. Pass that saved expiry, never re-evaluate it inside
-- an inline volatile argument through nested SQL/PLpgSQL wrappers.
create temporary table rendered_nonces as
select repeat(n,64) nonce_hash, rendered_at, rendered_at+interval '10 minutes' expires_at
from (select date_trunc('milliseconds',clock_timestamp()) rendered_at) rendered
cross join (values('1'),('2'),('3'),('4')) nonce(n);
select ok((select count(*)=4 and bool_and(expires_at=rendered_at+interval '10 minutes'
 and rendered_at=date_trunc('milliseconds',rendered_at)) from rendered_nonces),
 'every saved rendered nonce has exactly the original ten-minute millisecond lifetime');

create temporary table requested as
select * from public.request_account_deletion_v2('7a300000-0000-4000-8000-000000000001',
 '7a300000-0000-4000-8000-000000000010',repeat('1',64),(select expires_at from rendered_nonces where nonce_hash=repeat('1',64)),
 decode('00112233','hex'),repeat('b',64),repeat('c',64));
select is((select status from requested),'notice_period','a rendered nonce schedules deletion through v2');
select is((select count(*) from public.account_operation_nonces where nonce_hash=repeat('1',64)
 and operation='account_delete' and consumed_at is not null),1::bigint,
 'the operation records the nonce once, already spent');

select is((select expires_at from public.account_operation_nonces where nonce_hash=repeat('1',64)),
 (select expires_at from rendered_nonces where nonce_hash=repeat('1',64)),
 'the actual request stores the original saved expiry without renewal');

-- A failed operation spends nothing: the notice period already exists, so a
-- second request fails and its nonce is not recorded.
select throws_ok($$select * from public.request_account_deletion_v2('7a300000-0000-4000-8000-000000000001',
 '7a300000-0000-4000-8000-000000000010',repeat('2',64),(select expires_at from rendered_nonces where nonce_hash=repeat('2',64)),
 decode('00','hex'),repeat('b',64),repeat('d',64))$$,'23505','deletion_request_exists',
 'a second request while the first is pending is refused');
select is((select count(*) from public.account_operation_nonces where nonce_hash=repeat('2',64)),0::bigint,
 'the refused request left its nonce unspent');

create temporary table cancelled as
select * from public.cancel_account_deletion_v2('7a300000-0000-4000-8000-000000000001',
 '7a300000-0000-4000-8000-000000000010',repeat('3',64),(select expires_at from rendered_nonces where nonce_hash=repeat('3',64)),repeat('e',64));
select is((select status from cancelled),'active','a rendered nonce cancels through v2');
select is((select expires_at from public.account_operation_nonces where nonce_hash=repeat('3',64)),
 (select expires_at from rendered_nonces where nonce_hash=repeat('3',64)),
 'the actual cancellation stores the original saved expiry without renewal');

select is((select count(*) from auth.sessions where user_id='7a300000-0000-4000-8000-000000000001'),0::bigint,
 'cancellation revokes all pre-cancellation sessions');
-- A subsequent ordinary sign-in is represented by a new synthetic session;
-- preserve every original spent-nonce and expiry assertion under live authority.
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('7a300000-0000-4000-8000-000000000011','7a300000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp(),'aal1');

-- The first request's nonce is spent: replaying it fails on the nonce, before
-- anything about the account is read.
select throws_ok($$select * from public.request_account_deletion_v2('7a300000-0000-4000-8000-000000000001',
 '7a300000-0000-4000-8000-000000000011',repeat('1',64),(select expires_at from rendered_nonces where nonce_hash=repeat('1',64)),
 decode('00','hex'),repeat('b',64),repeat('f',64))$$,'22023','invalid_operation_nonce',
 'a spent nonce cannot be replayed');
select throws_ok($$select * from public.cancel_account_deletion_v2('7a300000-0000-4000-8000-000000000001',
 '7a300000-0000-4000-8000-000000000011',repeat('1',64),(select expires_at from rendered_nonces where nonce_hash=repeat('1',64)),repeat('9',64))$$,
 '22023','invalid_operation_nonce','nor spent on the other operation');

-- A spent hash lives until its nonce would have expired, then goes.
update public.account_operation_nonces set issued_at=clock_timestamp()-interval '12 minutes',
 expires_at=clock_timestamp()-interval '2 minutes' where nonce_hash=repeat('1',64);
create temporary table again as
select * from public.request_account_deletion_v2('7a300000-0000-4000-8000-000000000001',
 '7a300000-0000-4000-8000-000000000011',repeat('4',64),(select expires_at from rendered_nonces where nonce_hash=repeat('4',64)),
 decode('00112233','hex'),repeat('b',64),repeat('0',64));
select is((select count(*) from public.account_operation_nonces where nonce_hash=repeat('1',64)),0::bigint,
 'an expired spent hash is pruned by the next operation');
select is((select count(*) from public.account_operation_nonces where nonce_hash in (repeat('3',64),repeat('4',64))),2::bigint,
 'unexpired spent hashes are kept');

select * from finish();
rollback;
