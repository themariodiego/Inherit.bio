begin;
select plan(26);
-- api.subject-sharing stop (migration 20261016180000_subject_sharing_stop;
-- owner decision 2026-10-16, "The subjects endpoints (G2.1)"). Synthetic
-- accounts only. Everything rolls back.

insert into auth.users (id, email, raw_user_meta_data) values
 ('7a100000-0000-4000-8000-000000000001', 'subject-sharing-alpha@example.invalid', '{}'),
 ('7a100000-0000-4000-8000-000000000002', 'subject-sharing-beta@example.invalid', '{}'),
 ('7a100000-0000-4000-8000-000000000003', 'subject-sharing-gamma@example.invalid', '{}');
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
 ('7a100000-0000-4000-8000-000000000011', '7a100000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal1'),
 ('7a100000-0000-4000-8000-000000000013', '7a100000-0000-4000-8000-000000000003', clock_timestamp(), clock_timestamp(), 'aal1');
insert into auth.sessions (id, user_id, created_at, updated_at, aal, not_after) values
 ('7a100000-0000-4000-8000-000000000019', '7a100000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal1',
  clock_timestamp() - interval '1 minute');

create temporary table fx as select
 '7a100000-0000-4000-8000-000000000001'::uuid alpha,
 '7a100000-0000-4000-8000-000000000002'::uuid beta,
 '7a100000-0000-4000-8000-000000000003'::uuid gamma,
 '7a100000-0000-4000-8000-000000000011'::uuid alpha_session,
 '7a100000-0000-4000-8000-000000000013'::uuid gamma_session,
 '7a100000-0000-4000-8000-000000000019'::uuid alpha_ended_session,
 (select id from public.subjects where subject_account_id='7a100000-0000-4000-8000-000000000001' and subject_class='self') alpha_subject,
 (select id from public.subjects where subject_account_id='7a100000-0000-4000-8000-000000000002' and subject_class='self') beta_subject,
 (select id from public.subjects where subject_account_id='7a100000-0000-4000-8000-000000000003' and subject_class='self') gamma_subject,
 (select id from public.subject_principals where account_id='7a100000-0000-4000-8000-000000000001' and principal_kind='account_subject' and status='active') alpha_principal,
 (select id from public.subject_principals where account_id='7a100000-0000-4000-8000-000000000002' and principal_kind='account_subject' and status='active') beta_principal;

-- Beta shares with Alpha: one current family relationship links the accounts.
insert into public.subject_relationships(subject_id, data_subject_principal_id, recipient_principal_id,
 recipient_account_id, relationship_kind, relationship_revision, status)
select beta_subject, beta_principal, alpha_principal, alpha, 'family_member', 1, 'current' from fx;

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('subject-sharing-test:'||p,'sha256'),'hex') $$;
create function pg_temp.stop(p_account uuid, p_session uuid, p_subject uuid, p_counterpart uuid, p_code text,
 p_expires timestamptz default clock_timestamp() + interval '5 minutes')
returns table(ended_at timestamptz, deleted_counts jsonb) language sql volatile as
 $$ select * from public.stop_subject_sharing_v1(p_account, p_session, p_subject, p_counterpart, pg_temp.h(p_code), p_expires) $$;

-- Privileges -------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.stop_subject_sharing_v1(uuid,uuid,uuid,uuid,text,timestamptz)', 'execute'), false,
 'an authenticated client cannot stop sharing directly');
select is(has_function_privilege('anon', 'public.stop_subject_sharing_v1(uuid,uuid,uuid,uuid,text,timestamptz)', 'execute'), false,
 'anon cannot stop sharing');
select is(has_function_privilege('service_role', 'public.stop_subject_sharing_v1(uuid,uuid,uuid,uuid,text,timestamptz)', 'execute'), true,
 'only the service role reaches the stop door');
select is(has_function_privilege('service_role', 'private.record_subject_operation_nonce_v1(uuid,uuid,text,uuid,text,timestamptz)', 'execute'), false,
 'the nonce recorder is reachable only through the door');
select ok((select pg_get_constraintdef(oid) like '%subject_sharing_stop%' and pg_get_constraintdef(oid) like '%other_adult_upload_artifact_sign%'
  and pg_get_constraintdef(oid) like '%account_delete_cancel%'
  from pg_constraint where conrelid='public.account_operation_nonces'::regclass and conname='account_operation_nonces_operation_check'),
 'the nonce store admits the stop operation and keeps every earlier one');

-- Refusals before any write ---------------------------------------------------------
select throws_ok($$select * from pg_temp.stop((select alpha from fx), (select alpha_session from fx), (select gamma_subject from fx), (select beta from fx), 'wrong-subject')$$,
 '42501', 'family sharing authority is unavailable', 'a code for a record of another account cannot stop this pair');
select throws_ok($$select * from pg_temp.stop((select alpha from fx), (select alpha_session from fx), (select alpha_subject from fx), (select alpha from fx), 'own')$$,
 '42501', 'family sharing authority is unavailable', 'an account cannot stop sharing with itself');
select throws_ok($$select * from pg_temp.stop((select alpha from fx), (select alpha_ended_session from fx), (select beta_subject from fx), (select beta from fx), 'ended-session')$$,
 '42501', 'subject operation unavailable', 'an ended auth session cannot stop sharing');
select throws_ok($$select * from pg_temp.stop((select alpha from fx), (select gamma_session from fx), (select beta_subject from fx), (select beta from fx), 'foreign-session')$$,
 '42501', 'subject operation unavailable', 'another account''s session cannot stop sharing');
select throws_ok($$select * from pg_temp.stop((select alpha from fx), (select alpha_session from fx), (select beta_subject from fx), (select beta from fx), 'expired',
   clock_timestamp() - interval '1 second')$$,
 '22023', 'invalid_operation_nonce', 'an expired code is refused');
select throws_ok($$select * from pg_temp.stop((select alpha from fx), (select alpha_session from fx), (select beta_subject from fx), (select beta from fx), 'too-long',
   clock_timestamp() + interval '11 minutes')$$,
 '22023', 'invalid_operation_nonce', 'a code claiming more than ten minutes is refused');
select throws_ok($$select * from public.stop_subject_sharing_v1((select alpha from fx), (select alpha_session from fx), (select beta_subject from fx), (select beta from fx),
   'not-a-hash', clock_timestamp() + interval '5 minutes')$$,
 '22023', 'invalid_operation_nonce', 'only a code''s SHA-256 is accepted');
select throws_ok($$select * from pg_temp.stop((select alpha from fx), (select alpha_session from fx), (select beta_subject from fx), (select gamma from fx), 'unlinked')$$,
 '42501', 'family sharing authority is unavailable', 'a record of one counterpart cannot name another');
select is((select count(*) from public.account_operation_nonces where account_id=(select alpha from fx)), 0::bigint,
 'a refused stop records no code');
select is((select count(*) from public.family_sharing_stops where account_low_id in ((select alpha from fx),(select beta from fx))), 0::bigint,
 'a refused stop writes no tombstone');

-- Gamma has no link with Alpha: the shared stop refuses, and its code is not spent.
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
 ('7a100000-0000-4000-8000-000000000021', '7a100000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal1');
select throws_ok($$select * from pg_temp.stop((select alpha from fx), '7a100000-0000-4000-8000-000000000021', (select gamma_subject from fx), (select gamma from fx), 'no-link')$$,
 '55000', 'no family sharing between these accounts', 'an unlinked counterpart refuses with the shared stop''s own error');
select is((select count(*) from public.account_operation_nonces where nonce_hash=pg_temp.h('no-link')), 0::bigint,
 'a stop that fails rolls back its own code record');

-- The stop ---------------------------------------------------------------------------
create temporary table stopped as
 select * from pg_temp.stop((select alpha from fx), (select alpha_session from fx), (select beta_subject from fx), (select beta from fx), 'first');
select is((select count(*) from stopped), 1::bigint, 'the stop returns one row');
select ok((select ended_at is not null and deleted_counts ? 'portrait_results' and deleted_counts ? 'chat_messages' from stopped),
 'it returns the shared stop''s end time and deleted counts');
select is((select count(*) from public.family_sharing_stops
  where account_low_id=least((select alpha from fx),(select beta from fx)) and account_high_id=greatest((select alpha from fx),(select beta from fx))
   and stopped_by_account_id=(select alpha from fx) and ended_at=(select ended_at from stopped)), 1::bigint,
 'the tombstone both accounts read is written once');
select is((select count(*) from public.subject_relationships where subject_id=(select beta_subject from fx)
  and relationship_kind='family_member' and status='current'), 0::bigint, 'the family relationship is revoked');
select is((select operation||'|'||account_id::text||'|'||session_id::text from public.account_operation_nonces where nonce_hash=pg_temp.h('first')),
 'subject_sharing_stop|'||(select alpha from fx)::text||'|'||(select alpha_session from fx)::text,
 'the code''s hash is recorded once, with its account, session and operation');
select ok((select consumed_at is not null and expires_at>clock_timestamp() from public.account_operation_nonces where nonce_hash=pg_temp.h('first')),
 'the record is consumed and kept until the code would have expired');
select is((select count(*) from public.worker_jobs where kind='revoke_purge'
  and user_id in ((select alpha from fx),(select beta from fx)) and status='queued'), 2::bigint,
 'the derived purge is queued for each side');

-- Replay ------------------------------------------------------------------------------
select throws_ok($$select * from pg_temp.stop((select alpha from fx), (select alpha_session from fx), (select beta_subject from fx), (select beta from fx), 'first')$$,
 '22023', 'invalid_operation_nonce', 'the same code cannot be spent twice');
select is((select count(*) from public.family_sharing_stops where account_low_id=least((select alpha from fx),(select beta from fx))), 1::bigint,
 'a replay writes no second tombstone');

select * from finish();
rollback;
