begin;
select plan(21);

-- Only this synthetic account is touched. Provision its real account principal
-- through the normal auth trigger; never clear unrelated subjects or mail.
insert into auth.users (id, email, raw_user_meta_data)
values ('72000000-0000-0000-0000-000000000001',
  'mail-clock@example.invalid', '{"display_name":"Mail clock fixture"}');

-- Readiness now requires a real processed source; preserve all clock/replay
-- assertions while making their existing synthetic target valid.
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
select '72000000-0000-0000-0000-000000000002',owner_account_id,id,
 owner_account_id::text||'/mail-clock-fixture','synthetic.txt','array_ancestry',1,1,'annotated'
from public.subjects where owner_account_id='72000000-0000-0000-0000-000000000001' and subject_class='self';

create function pg_temp.enqueue_fixture(p_key text, p_expiry timestamptz default null)
returns uuid language sql as $$
  select public.enqueue_account_mail(
    '72000000-0000-0000-0000-000000000001',
    decode(repeat('01', 40), 'hex'), repeat('a', 64),
    'report-ready', 'report.ready', 'genome_file',
    '72000000-0000-0000-0000-000000000002',
    '{"reportCount":1,"dashboardUrl":"https://example.invalid/reports"}',
    repeat(p_key, 64), p_expiry
  );
$$;

create temporary table clock_fixture (observed_at timestamptz, outbox_id uuid);
insert into clock_fixture values (clock_timestamp(), null);
select lives_ok($$
  update clock_fixture set outbox_id = public.enqueue_account_mail(
    '72000000-0000-0000-0000-000000000001',
    decode(repeat('01', 40), 'hex'), repeat('a', 64),
    'report-ready', 'report.ready', 'genome_file',
    '72000000-0000-0000-0000-000000000002',
    '{"reportCount":1,"dashboardUrl":"https://example.invalid/reports"}',
    repeat('b', 64)
  )
$$, 'the same RPC accepts nine arguments with the default omitted');
select ok((select m.expires_at >= f.observed_at + interval '30 days'
  and m.expires_at <= clock_timestamp() + interval '30 days'
  and m.expires_at <= m.created_at + interval '30 days'
  from public.mail_outbox m join clock_fixture f on f.outbox_id = m.id),
  'default deadline belongs to the database clock and stays inside the existing cap');
select is((select state from public.mail_outbox where id = (select outbox_id from clock_fixture)),
  'queued', 'enqueue does not submit mail');
select is((select count(*) from public.mail_provider_attempts where outbox_id = (select outbox_id from clock_fixture)),
  0::bigint, 'enqueue makes no delivery attempt');

create temporary table first_mail as
select id, expires_at, contact_reference_id from public.mail_outbox
where id = (select outbox_id from clock_fixture);
select is(pg_temp.enqueue_fixture('b'), (select id from first_mail),
  'default replay returns the original id');
select is((select expires_at from public.mail_outbox where id = (select id from first_mail)),
  (select expires_at from first_mail), 'default replay never renews expiry');
select is((select contact_reference_id from public.mail_outbox where id = (select id from first_mail)),
  (select contact_reference_id from first_mail), 'default replay keeps the existing contact reference');

create temporary table shorter_fixture as select clock_timestamp() + interval '1 day' as deadline;
select lives_ok($$select pg_temp.enqueue_fixture('c', (select deadline from shorter_fixture))$$,
  'an explicit shorter deadline is accepted through the original ten-argument RPC');
select is((select expires_at from public.mail_outbox where idempotency_key = repeat('c', 64)),
  (select deadline from shorter_fixture), 'the explicit shorter deadline is stored exactly');
select is(pg_temp.enqueue_fixture('c'),
  (select id from public.mail_outbox where idempotency_key = repeat('c', 64)),
  'omitting expiry on replay of a shorter deadline returns the same row');
select is((select expires_at from public.mail_outbox where idempotency_key = repeat('c', 64)),
  (select deadline from shorter_fixture), 'replay cannot extend an explicit shorter deadline');

select throws_ok($$select pg_temp.enqueue_fixture('d', clock_timestamp() + interval '30 days 25 milliseconds')$$,
  '22023', 'invalid mail candidate', 'even 25 ms over the database cap is rejected');
select throws_ok($$select pg_temp.enqueue_fixture('d', clock_timestamp() - interval '1 millisecond')$$,
  '22023', 'invalid mail candidate', 'an expired explicit deadline is rejected');
select throws_ok($$select pg_temp.enqueue_fixture('b', clock_timestamp() + interval '31 days')$$,
  '22023', 'invalid mail candidate', 'replay does not bypass explicit deadline validation');
select lives_ok($$select pg_temp.enqueue_fixture('e', null)$$,
  'an explicit null selects the database default');
select is((select count(*) from public.mail_outbox
  where target_id = '72000000-0000-0000-0000-000000000002'), 3::bigint,
  'invalid deadlines and replays add no extra rows');

select is((select pronargs::integer from pg_proc where oid =
  'public.enqueue_account_mail(uuid,bytea,text,text,text,text,uuid,jsonb,text,timestamptz)'::regprocedure),
  10, 'the existing ten-argument function identity is preserved');
select is((select pronargdefaults::integer from pg_proc where oid =
  'public.enqueue_account_mail(uuid,bytea,text,text,text,text,uuid,jsonb,text,timestamptz)'::regprocedure),
  1, 'only the final deadline argument is optional');
select ok(has_function_privilege('service_role',
  'public.enqueue_account_mail(uuid,bytea,text,text,text,text,uuid,jsonb,text,timestamptz)', 'execute'),
  'service execution is preserved');
select ok(not has_function_privilege('authenticated',
  'public.enqueue_account_mail(uuid,bytea,text,text,text,text,uuid,jsonb,text,timestamptz)', 'execute'),
  'authenticated callers still cannot enqueue directly');
select ok(not has_function_privilege('anon',
  'public.enqueue_account_mail(uuid,bytea,text,text,text,text,uuid,jsonb,text,timestamptz)', 'execute'),
  'anonymous callers still cannot enqueue directly');

select * from finish();
rollback;
