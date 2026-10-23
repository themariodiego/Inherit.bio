begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- G8.5, api.llm-settings DELETE (20261024110000_copilot_settings_delete_nonce.sql;
-- owner decision of 23 October 2026, item 1: the DELETE reads the registered
-- nonce). The door records the hash of the nonce /settings/copilot rendered
-- for this account and session, through the account operation consumer, in
-- the same transaction and before the unchanged writer removes the setting,
-- its key and every permission bound to it. A replayed, foreign, expired or
-- malformed nonce writes nothing.
--
-- Every account, session, address and key is synthetic, and everything rolls
-- back. The routes verify a nonce's MAC before they reach this door
-- (src/lib/person-operation-nonce.ts); the hashes here are synthetic.
do $$ declare n integer; begin
 for n in 1..2 loop
  insert into auth.users(id,email,email_confirmed_at) values(('7c5d0000-0000-4000-8000-00000000000'||n)::uuid,'copilot-delete-'||n||'@e2e.local',now());
  insert into auth.sessions(id,user_id,created_at,updated_at,aal) values(('7c5d0000-0000-4000-8000-00000000001'||n)::uuid,
   ('7c5d0000-0000-4000-8000-00000000000'||n)::uuid,now(),now(),'aal1');
  update public.profiles set date_of_birth='1990-01-01' where id=('7c5d0000-0000-4000-8000-00000000000'||n)::uuid;
 end loop;
end $$;
create function pg_temp.account(n integer) returns uuid language sql immutable as $$ select ('7c5d0000-0000-4000-8000-00000000000'||n)::uuid $$;
create function pg_temp.session(n integer) returns uuid language sql immutable as $$ select ('7c5d0000-0000-4000-8000-00000000001'||n)::uuid $$;
create function pg_temp.hash(label text) returns text language sql immutable as $$ select encode(extensions.digest(convert_to(label,'UTF8'),'sha256'),'hex') $$;
create function pg_temp.soon() returns timestamptz language sql as $$ select clock_timestamp()+interval '5 minutes' $$;
-- A saved cloud provider with a stored key, through the real save door.
create function pg_temp.save(n integer) returns jsonb language sql as $$
 select public.save_own_copilot_settings_v1(pg_temp.account(n),pg_temp.session(n),
  jsonb_build_object('provider','openai_compatible','baseUrl','https://model.synthetic.invalid/v1','model','synthetic-model',
   'origin','https://model.synthetic.invalid','providerLabel','model.synthetic.invalid','providerClass','cloud',
   'runtimeAttestationFingerprint',repeat('a',64)),
  ('\x'||repeat('ab',40))::bytea,repeat('c',64),'wxyz');
$$;
create function pg_temp.stored(n integer) returns bigint language sql as $$
 select (select count(*) from public.llm_settings where user_id=pg_temp.account(n))
  +(select count(*) from public.llm_keys where user_id=pg_temp.account(n));
$$;
create function pg_temp.remove(n integer,nonce text,session_of integer default null,expires timestamptz default null) returns boolean language sql as $$
 select public.remove_own_copilot_settings_with_nonce_v1(pg_temp.account(n),pg_temp.session(coalesce(session_of,n)),
  pg_temp.hash(nonce),coalesce(expires,pg_temp.soon()));
$$;

select ok((pg_temp.save(1)->>'saved')::boolean and (pg_temp.save(2)->>'saved')::boolean,'two accounts each saved a provider with a key');
select is(pg_temp.stored(1),2::bigint,'the first account holds its setting and its key');

-- 1. The door removes the setting and the key, and records the nonce consumed, once.
select is(pg_temp.remove(1,'delete-one'),true,'the door removes the provider with the page''s nonce');
select is(pg_temp.stored(1),0::bigint,'the setting and the key are gone together');
select ok(exists(select 1 from public.account_operation_nonces where nonce_hash=pg_temp.hash('delete-one')
  and account_id=pg_temp.account(1) and session_id=pg_temp.session(1) and operation='provider_setting_delete' and consumed_at is not null),
 'the nonce is recorded consumed for this account, session and operation');
select is(pg_temp.stored(2),2::bigint,'the other account''s provider is untouched');

-- 2. A replay writes nothing.
select ok((pg_temp.save(1)->>'saved')::boolean,'the first account saves again');
select throws_ok($$select pg_temp.remove(1,'delete-one')$$,'22023','invalid_operation_nonce','a replayed nonce is refused');
select is(pg_temp.stored(1),2::bigint,'and removes nothing');

-- 3. Another account's session, an expired or too-distant expiry, and a malformed hash are refused, and nothing is removed.
select throws_ok($$select pg_temp.remove(1,'foreign-session',2)$$,'42501','operation unavailable','a session of another account is refused');
select throws_ok($$select pg_temp.remove(1,'expired',null,clock_timestamp()-interval '1 second')$$,'22023','invalid_operation_nonce',
 'an expired nonce is refused');
select throws_ok($$select pg_temp.remove(1,'distant',null,clock_timestamp()+interval '11 minutes')$$,'22023','invalid_operation_nonce',
 'an expiry beyond ten minutes is refused');
select throws_ok($$select public.remove_own_copilot_settings_with_nonce_v1(pg_temp.account(1),pg_temp.session(1),'not-a-hash',pg_temp.soon())$$,
 '22023','invalid_operation_nonce','a malformed hash is refused');
select is(pg_temp.stored(1),2::bigint,'none of the refusals removed anything');
select is((select count(*) from public.account_operation_nonces where account_id=pg_temp.account(1)
  and nonce_hash in (pg_temp.hash('foreign-session'),pg_temp.hash('expired'),pg_temp.hash('distant'))),0::bigint,
 'and none of them recorded a nonce');

-- 4. The operation is not usable through any other door, and other operations still are what they were.
select throws_ok($$select private.consume_account_operation_nonce_v1(pg_temp.account(1),pg_temp.session(1),'provider_setting_remove',
  pg_temp.hash('wrong-operation'),pg_temp.soon())$$,'22023','invalid_operation_nonce','an operation the consumer does not know is refused');
select lives_ok($$select private.consume_account_operation_nonce_v1(pg_temp.account(1),pg_temp.session(1),'consent_revoke',
  pg_temp.hash('still-consent'),pg_temp.soon())$$,'an earlier operation is still accepted');

-- 5. Who may call it, and what the bodies are.
select ok(has_function_privilege('service_role','public.remove_own_copilot_settings_with_nonce_v1(uuid,uuid,text,timestamptz)','execute'),
 'the service role may call the door');
select ok(not has_function_privilege(r,'public.remove_own_copilot_settings_with_nonce_v1(uuid,uuid,text,timestamptz)','execute'),
 r||' may not call the door') from unnest(array['anon','authenticated','inherit_upload_only']) r;
select is((select proacl::text from pg_proc where oid='public.remove_own_copilot_settings_with_nonce_v1(uuid,uuid,text,timestamptz)'::regprocedure),
 '{postgres=X/postgres,service_role=X/postgres}','the door''s ACL is exactly owner and service role');
select ok((select bool_and(md5(pg_get_functiondef(p.oid))=x.m) from pg_proc p join (values
  ('private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)','6869593d67ff37d93a6d4caea62f01c3'),
  ('public.remove_own_copilot_settings_v1(uuid,uuid)','f45c9a8b18e64acc5b3e13612f1d6d86'))x(s,m) on p.oid=x.s::regprocedure),
 'the consumer is its reviewed successor and the removal writer is unchanged');
select ok(pg_get_constraintdef(c.oid) like '%provider_setting_delete%' and pg_get_constraintdef(c.oid) like '%subject_download_open%'
  and pg_get_constraintdef(c.oid) like '%subject_transfer%' and pg_get_constraintdef(c.oid) like '%adult_invitation_create%',
 'the operation check gains the operation and keeps the ones it held') from pg_constraint c
 where c.conrelid='public.account_operation_nonces'::regclass and c.conname='account_operation_nonces_operation_check';

select * from finish();
rollback;
