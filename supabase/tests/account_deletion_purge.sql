begin;
select plan(17);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '74000000-0000-0000-0000-000000000001',
  'purge-test@example.invalid',
  '{"display_name":"Purge test"}'
);
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values (
  '74000000-0000-4000-8000-000000000010',
  '74000000-0000-0000-0000-000000000001',
  clock_timestamp(), clock_timestamp(), 'aal1'
);

select public.issue_account_operation_nonce_v1(
  '74000000-0000-0000-0000-000000000001',
  '74000000-0000-4000-8000-000000000010',
  'account_delete', repeat('1', 64),
  clock_timestamp() + interval '10 minutes'
);

create temporary table purge_request as
select * from public.request_account_deletion_v1(
  '74000000-0000-0000-0000-000000000001',
  '74000000-0000-4000-8000-000000000010',
  repeat('1', 64), decode('0011223344556677', 'hex'), repeat('2', 64),
  repeat('3', 64)
);

with deadline as (
  select clock_timestamp() - interval '8 days' as requested_at
)
update public.account_deletion_requests d
set requested_at = deadline.requested_at,
    notice_ends_at = deadline.requested_at + interval '7 days'
from deadline
where d.id = (select deletion_id from purge_request);
update public.retention_rows
set fixed_deadline = (
  select notice_ends_at from public.account_deletion_requests
  where id = (select deletion_id from purge_request)
)
where target_id = '74000000-0000-0000-0000-000000000001'
  and retention_id = 'account-deletion.notice-7d';
update public.retention_due_phases
set phase_deadline = (
  select notice_ends_at from public.account_deletion_requests
  where id = (select deletion_id from purge_request)
)
where target_id = '74000000-0000-0000-0000-000000000001'
  and retention_id = 'account-deletion.notice-7d';

insert into public.subject_invitations (
  target_kind, target_id, inviter_principal_id, email_hmac,
  token_hash, invitation_kind, expires_at
)
select 'subject', s.id, sp.id, repeat('5', 64), repeat('6', 64),
  'adult_subject', clock_timestamp() + interval '1 day'
from public.subjects s
join public.subject_principals sp on sp.subject_id = s.id
where s.subject_account_id = '74000000-0000-0000-0000-000000000001'
limit 1;
select throws_ok(
  $$select * from public.claim_due_account_deletion_v1(repeat('4', 64), 300)$$,
  '55000', 'unsupported_account_graph',
  'an unsupported relationship blocks before the first physical delete'
);
delete from public.subject_invitations where token_hash = repeat('6', 64);

create temporary table claimed_deletion as
select * from public.claim_due_account_deletion_v1(repeat('4', 64), 300);

select is((select deletion_id from claimed_deletion),
  (select deletion_id from purge_request),
  'the worker claims the exact due account deletion');
select is((select state from public.account_deletion_requests
  where id = (select deletion_id from purge_request)), 'delete_started',
  'the irreversible delete-start marker is durable');
select is((select status from public.retention_due_phases
  where target_id = '74000000-0000-0000-0000-000000000001'), 'claimed',
  'the due phase carries the same worker claim');
select is((select state from public.purge_manifests), 'executing',
  'the frozen manifest enters execution');
select is((select storage_objects from claimed_deletion), '[]'::jsonb,
  'an account without objects freezes an exact empty storage set');
select is((select count(*) from auth.sessions
  where user_id = '74000000-0000-0000-0000-000000000001'), 0::bigint,
  'all Auth sessions are revoked at the deadline');

select lives_ok(
  $$select public.complete_account_deletion_storage_v1(
    (select deletion_id from purge_request), repeat('4', 64)
  )$$,
  'the empty storage manifest completes explicitly'
);
select is(
  public.purge_account_deletion_database_v1(
    (select deletion_id from purge_request), repeat('4', 64)
  ),
  '74000000-0000-0000-0000-000000000001'::uuid,
  'the database purge returns only the Auth user to delete last'
);
select is((select count(*) from public.profiles
  where id = '74000000-0000-0000-0000-000000000001'), 0::bigint,
  'the profile is purged before Auth');
select is((select count(*) from public.subjects
  where subject_account_id = '74000000-0000-0000-0000-000000000001'), 0::bigint,
  'the self subject is purged before Auth');
select is((select count(*) from public.subject_principals
  where account_id = '74000000-0000-0000-0000-000000000001'), 0::bigint,
  'the account principal is purged before Auth');
select is((select count(*) from auth.users
  where id = '74000000-0000-0000-0000-000000000001'), 1::bigint,
  'Auth remains until application zero-residual proof succeeds');

delete from auth.users
where id = '74000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.finalize_account_deletion_v1(
    (select deletion_id from purge_request), repeat('4', 64)
  )$$,
  'the worker finalizes only after Auth deletion'
);
select is((select state from public.account_deletion_requests
  where id = (select deletion_id from purge_request)), 'complete',
  'the deletion control row is terminal');
select is((select account_id from public.account_deletion_requests
  where id = (select deletion_id from purge_request)), null::uuid,
  'the retained control row no longer contains the Auth user id');
select is((select state from public.retention_rows), 'complete',
  'the retention row is terminalized rather than erased');

select * from finish();
rollback;
