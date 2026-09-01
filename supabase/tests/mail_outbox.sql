begin;
select plan(11);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '71000000-0000-0000-0000-000000000001',
  'mail-worker@example.invalid',
  '{"display_name":"Mail worker"}'
);

delete from public.subject_relationships;
delete from public.subject_account_bindings;
delete from public.subject_principals;
delete from public.subjects;

insert into public.subjects (
  id, owner_account_id, subject_account_id, subject_class, upload_class,
  display_label, lifecycle
)
values (
  '71000000-0000-0000-0000-000000000002',
  '71000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001',
  'self', 'self', 'Me', 'active'
);

insert into public.subject_principals (
  id, subject_id, account_id, principal_kind, principal_revision, status
)
values (
  '71000000-0000-0000-0000-000000000003',
  '71000000-0000-0000-0000-000000000002',
  '71000000-0000-0000-0000-000000000001',
  'account_subject', 1, 'active'
);

select lives_ok(
  $$select public.enqueue_account_mail(
    '71000000-0000-0000-0000-000000000001',
    decode('00112233445566778899aabbccddeeff', 'hex'),
    repeat('a', 64),
    'report-ready',
    'report.ready',
    'genome_file',
    '71000000-0000-0000-0000-000000000004',
    '{"reportCount":2,"dashboardUrl":"https://inherit.bio/genome/me/reports"}',
    repeat('b', 64),
    clock_timestamp() + interval '1 day'
  )$$,
  'a server-owned mail candidate is enqueued'
);

select is((select count(*) from public.mail_outbox), 1::bigint,
  'one outbox row is stored');
select is((select count(*) from public.encrypted_contact_references), 1::bigint,
  'the recipient is stored only as an encrypted contact reference');

select public.enqueue_account_mail(
  '71000000-0000-0000-0000-000000000001',
  decode('ffeeddccbbaa99887766554433221100', 'hex'),
  repeat('a', 64),
  'report-ready',
  'report.ready',
  'genome_file',
  '71000000-0000-0000-0000-000000000004',
  '{"reportCount":2,"dashboardUrl":"https://inherit.bio/genome/me/reports"}',
  repeat('b', 64),
  clock_timestamp() + interval '1 day'
);
select is((select count(*) from public.mail_outbox), 1::bigint,
  'semantic replay does not duplicate the outbox row');

create temporary table claimed_mail as
select * from public.claim_mail_outbox();

select is((select count(*) from claimed_mail), 1::bigint,
  'the worker claims one due row');
select is((select attempt_ordinal from claimed_mail), 1::smallint,
  'the first claim has attempt ordinal one');
select is((select state from public.mail_outbox), 'claimed',
  'the claim transition is durable');

select public.complete_mail_attempt(
  (select outbox_id from claimed_mail),
  (select attempt_ordinal from claimed_mail),
  true,
  repeat('c', 64),
  'accepted'
);

select is((select state from public.mail_outbox), 'submitted',
  'provider acceptance marks the outbox submitted');
select is((select status from public.mail_deliveries), 'accepted',
  'provider acceptance creates the delivery projection');

select ok(
  public.record_resend_mail_event(
    repeat('c', 64), repeat('d', 64), 'delivered', clock_timestamp()
  ),
  'a signed provider event matches through its keyed message hash'
);
select is((select state from public.mail_outbox), 'delivered',
  'the delivery event terminalizes the outbox row');

select * from finish();
rollback;
