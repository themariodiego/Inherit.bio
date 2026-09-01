begin;
select plan(18);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '73000000-0000-0000-0000-000000000001',
  'deletion-test@example.invalid',
  '{"display_name":"Deletion test"}'
);

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values
  (
    '73000000-0000-4000-8000-000000000010',
    '73000000-0000-0000-0000-000000000001',
    clock_timestamp(), clock_timestamp(), 'aal1'
  ),
  (
    '73000000-0000-4000-8000-000000000011',
    '73000000-0000-0000-0000-000000000001',
    clock_timestamp(), clock_timestamp(), 'aal1'
  );

select lives_ok(
  $$select public.issue_account_operation_nonce_v1(
    '73000000-0000-0000-0000-000000000001',
    '73000000-0000-4000-8000-000000000010',
    'account_delete', repeat('a', 64),
    clock_timestamp() + interval '10 minutes'
  )$$,
  'a recent verified session can obtain a one-time operation nonce'
);

create temporary table requested_deletion as
select * from public.request_account_deletion_v1(
  '73000000-0000-0000-0000-000000000001',
  '73000000-0000-4000-8000-000000000010',
  repeat('a', 64),
  decode('00112233445566778899aabbccddeeff', 'hex'),
  repeat('b', 64),
  repeat('c', 64)
);

select is((select status from requested_deletion), 'notice_period',
  'deletion enters the notice period');
select ok(
  abs(extract(epoch from (
    (select notice_ends_at from requested_deletion)
    - (select requested_at from public.account_deletion_requests)
  )) - 604800) < 0.001,
  'the notice deadline is fixed at seven days from the request'
);
select isnt(
  (select deletion_requested_at from public.profiles
   where id = '73000000-0000-0000-0000-000000000001'),
  null::timestamptz,
  'the account deletion hold is active'
);
select is(
  (select count(*) from public.retention_rows
   where target_id = '73000000-0000-0000-0000-000000000001'
     and retention_id = 'account-deletion.notice-7d'
     and state = 'scheduled'),
  1::bigint,
  'one canonical retention row is scheduled'
);
select is((select count(*) from public.retention_due_phases), 1::bigint,
  'one deadline phase is precreated');
select is((select count(*) from public.purge_manifests
  where manifest_class = 'complete-retention' and state = 'frozen'), 1::bigint,
  'a complete-retention manifest is frozen for the original deadline');
select is((select count(*) from public.mail_outbox
  where template_id = 'account-deletion-notice'), 1::bigint,
  'the deletion notice is committed atomically to the outbox');
select is((select count(*) from auth.sessions
  where id = '73000000-0000-4000-8000-000000000011'), 0::bigint,
  'other sessions are revoked');
select is((select count(*) from auth.sessions
  where id = '73000000-0000-4000-8000-000000000010'), 1::bigint,
  'the requesting session survives for notice-period operations');
select throws_ok(
  $$select * from public.request_account_deletion_v1(
    '73000000-0000-0000-0000-000000000001',
    '73000000-0000-4000-8000-000000000010',
    repeat('a', 64), decode('00', 'hex'), repeat('b', 64), repeat('d', 64)
  )$$,
  '22023', 'invalid_operation_nonce',
  'a consumed nonce cannot be replayed'
);

select public.issue_account_operation_nonce_v1(
  '73000000-0000-0000-0000-000000000001',
  '73000000-0000-4000-8000-000000000010',
  'account_delete_cancel', repeat('e', 64),
  clock_timestamp() + interval '10 minutes'
);

create temporary table cancelled_deletion as
select * from public.cancel_account_deletion_v1(
  '73000000-0000-0000-0000-000000000001',
  '73000000-0000-4000-8000-000000000010',
  repeat('e', 64), repeat('f', 64)
);

select is((select status from cancelled_deletion), 'active',
  'cancellation restores the account state');
select is((select state from public.account_deletion_requests), 'cancelled',
  'the deletion request is terminally cancelled');
select is(
  (select deletion_requested_at from public.profiles
   where id = '73000000-0000-0000-0000-000000000001'),
  null::timestamptz,
  'the deletion hold is cleared'
);
select is((select state from public.retention_rows
  where retention_id = 'account-deletion.notice-7d'), 'cancelled',
  'the scheduled retention row is cancelled');
select is((select status from public.retention_due_phases), 'cancelled',
  'the unclaimed deadline phase is cancelled');
select is((select state from public.purge_manifests), 'cancelled',
  'the unstarted manifest is cancelled');
select is((select count(*) from public.mail_outbox
  where template_id = 'account-deletion-cancelled'), 1::bigint,
  'the cancellation notice is committed atomically');

select * from finish();
rollback;
