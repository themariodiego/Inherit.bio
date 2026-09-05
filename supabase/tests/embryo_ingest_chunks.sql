begin;
select no_plan();

-- Synthetic lifecycle fixtures; these tests exercise persistence primitives,
-- not the still-unimplemented full legal/capability authority resolver.
insert into auth.users(id, email) values
  ('7b000000-0000-4000-8000-000000000001', 'ingest-owner@example.invalid');
insert into auth.sessions(id, user_id, created_at, updated_at, aal) values
  ('7b000000-0000-4000-8000-000000000002', '7b000000-0000-4000-8000-000000000001',
    clock_timestamp(), clock_timestamp(), 'aal1');
insert into public.subject_principals(id, account_id, principal_kind) values
  ('7b000000-0000-4000-8000-000000000003', '7b000000-0000-4000-8000-000000000001', 'genetic_parent');

create function pg_temp.new_attempt(p_capacity bigint default 200000000)
returns uuid language plpgsql as $$
declare
  v_draft uuid := gen_random_uuid();
  v_cohort uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_retention uuid;
  v_deadline timestamptz := clock_timestamp() + interval '24 hours';
begin
  insert into public.embryo_cohort_drafts (
    id, owner_account_id, uploader_principal_id, upload_class, basis_case,
    embryo_count, state, fixed_expires_at, finalized_at, upload_situation
  ) values (v_draft, '7b000000-0000-4000-8000-000000000001',
    '7b000000-0000-4000-8000-000000000003', 'embryo_own', 'true_two_parent',
    2, 'finalized', clock_timestamp() + interval '30 days', clock_timestamp(), 'own_embryos');
  insert into public.embryo_cohorts (
    id, draft_id, owner_account_id, upload_class, basis_case,
    basis_revision, participant_set_revision, donor_attribution_revision,
    embryo_count, retention_expires_at
  ) values (v_cohort, v_draft, '7b000000-0000-4000-8000-000000000001',
    'embryo_own', 'true_two_parent', 1, 1, 1, 2, clock_timestamp() + interval '24 months');
  insert into public.embryo_ingest_sessions (
    id, cohort_id, originating_session_id, uploader_principal_id, basis_case,
    basis_revision, participant_set_revision, donor_attribution_revision,
    source_binding_fingerprint, expires_at, account_auth_session_revision,
    account_revision, ingest_revision, cohort_lifecycle_revision, declared_capacity_bytes
  ) values (v_session, v_cohort, '7b000000-0000-4000-8000-000000000002',
    '7b000000-0000-4000-8000-000000000003', 'true_two_parent', 1, 1, 1,
    repeat('a',64), v_deadline, 1, 1, 1, 1, p_capacity);
  insert into public.retention_rows (
    retention_id, target_kind, target_id, retention_revision,
    target_lifecycle_revision, disposition_revision, fixed_deadline
  ) values ('embryo.ingest-session-24h', 'ingest_session', v_session, 1, 1, 1, v_deadline)
    returning id into v_retention;
  insert into public.retention_due_phases (
    retention_row_id, retention_id, phase_id, phase_kind, phase_revision,
    phase_deadline, target_kind, target_id, target_lifecycle_revision,
    disposition_revision, recipient_authority_kind, recipient_authority_revision,
    immutable_envelope
  ) values (v_retention, 'embryo.ingest-session-24h', 'ingest-abandoned-no-source',
    'ingest-abandoned-no-source', 1, v_deadline, 'ingest_session', v_session,
    1, 1, 'record-key-recipients', 1, jsonb_build_object('cohortId', v_cohort, 'ingestRevision', 1));
  return v_session;
end;
$$;

create function pg_temp.fragments() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('ordinal',0,'sha256',repeat('b',64),'bytes',80,'lines',4),
    jsonb_build_object('ordinal',1,'sha256',repeat('c',64),'bytes',80,'lines',4)
  );
$$;
create temporary table attempt(id uuid);
insert into attempt select pg_temp.new_attempt();
create temporary table first_receipt as select private.reserve_embryo_ingest_chunk_v1(
  (select id from attempt), 0, repeat('d',64), 100, 2, 60, pg_temp.fragments()) as body;
select is((select body->>'status' from first_receipt), 'reserved', 'a chunk reserves its capacity');
select is((select count(*) from public.embryo_ingest_fragments), 2::bigint, 'two ordinal fragments, never one multisample object');
select is((select count(distinct object_id) from public.embryo_ingest_fragments), 2::bigint, 'each ordinal gets an independent random object id');
select is((select array_agg(sample_ordinal order by sample_ordinal) from public.embryo_ingest_fragments),
  array[0,1]::smallint[], 'stable ordinal order');
select is((select accepted_bytes from public.embryo_ingest_sessions where id=(select id from attempt)),
  100::bigint, 'bytes charged before Storage writes');
select is((select expected_next_sequence from public.embryo_ingest_sessions where id=(select id from attempt)),
  0, 'a reservation is not a stored chunk');
select is(private.reserve_embryo_ingest_chunk_v1(
  (select id from attempt), 0, repeat('d',64), 100, 2, 60, pg_temp.fragments()),
  (select body from first_receipt), 'identical retry preserves every object name');
select is((select accepted_bytes from public.embryo_ingest_sessions where id=(select id from attempt)),
  100::bigint, 'retry does not double-charge bytes');
select is((select accepted_chunks from public.embryo_ingest_sessions where id=(select id from attempt)),
  1, 'retry does not double-charge chunks');
select is(private.commit_embryo_ingest_chunk_v1((select id from attempt),0,repeat('d',64))->>'status',
  'stored', 'verified objects commit their receipt');
select is((select expected_next_sequence from public.embryo_ingest_sessions where id=(select id from attempt)),
  1, 'commit advances exactly one sequence');
select is(private.commit_embryo_ingest_chunk_v1((select id from attempt),0,repeat('d',64))->>'status',
  'stored', 'commit retry is idempotent');
select is((select expected_next_sequence from public.embryo_ingest_sessions where id=(select id from attempt)),
  1, 'commit retry never advances twice');
select is(private.reserve_embryo_ingest_chunk_v1(
  (select id from attempt), 1, repeat('e',64), 100, 2, 60, pg_temp.fragments())->>'status',
  'reserved', 'next contiguous chunk reserves');
select is(private.reserve_embryo_ingest_chunk_v1(
  (select id from attempt), 1, repeat('f',64), 100, 2, 60, pg_temp.fragments())->>'status',
  'failure_pending', 'different bytes at the same sequence terminally deny the attempt');
select is((select failure_code from public.embryo_ingest_sessions where id=(select id from attempt)),
  'chunk', 'failure reason is coded, never source text');
select is((select count(*) from public.embryo_ingest_fragments), 4::bigint, 'failure preserves all attempt object references for unwind');
select is((select status from public.retention_due_phases where target_id=(select id from attempt)),
  'pending', 'failure never cancels the due target');
select is(private.commit_embryo_ingest_chunk_v1((select id from attempt),1,repeat('e',64))->>'status',
  'failure_pending', 'failed attempt cannot commit pending objects');

-- Independent hostile inputs, each on its own still-live attempt.
create temporary table cases(label text, seq integer, bytes integer, records integer, line_bytes integer, fragments jsonb);
insert into cases values
  ('negative sequence',-1,100,2,60,pg_temp.fragments()),
  ('sequence gap',1,100,2,60,pg_temp.fragments()),
  ('oversized chunk',0,4000001,2,60,pg_temp.fragments()),
  ('negative bytes',0,-1,2,60,pg_temp.fragments()),
  ('too many records',0,100,10000001,60,pg_temp.fragments()),
  ('oversized logical line',0,2000000,2,1000001,pg_temp.fragments()),
  ('line longer than bytes',0,100,2,101,pg_temp.fragments()),
  ('null records',0,100,null,60,pg_temp.fragments()),
  ('null manifest',0,100,2,60,null),
  ('object manifest',0,100,2,60,'{}'),
  ('non-object fragment',0,100,2,60,'[1]'),
  ('extra source-derived field',0,100,2,60,jsonb_build_array(pg_temp.fragments()->0 || '{"label":"forbidden"}')),
  ('duplicate ordinal',0,100,2,60,jsonb_build_array(pg_temp.fragments()->0,pg_temp.fragments()->0)),
  ('out of range ordinal',0,100,2,60,jsonb_build_array(pg_temp.fragments()->0 || '{"ordinal":2}')),
  ('string ordinal',0,100,2,60,jsonb_build_array(pg_temp.fragments()->0 || '{"ordinal":"0"}')),
  ('fractional ordinal',0,100,2,60,jsonb_build_array(pg_temp.fragments()->0 || '{"ordinal":0.5}')),
  ('huge ordinal',0,100,2,60,jsonb_build_array(pg_temp.fragments()->0 || '{"ordinal":999999999999999999999}')),
  ('oversized fragment',0,100,2,60,jsonb_build_array(pg_temp.fragments()->0 || '{"bytes":99999999}'));
select is(private.reserve_embryo_ingest_chunk_v1(
  pg_temp.new_attempt(),seq,repeat('d',64),bytes,records,line_bytes,fragments)->>'status',
  'failure_pending', label || ' fails closed') from cases;

update attempt set id=pg_temp.new_attempt(100);
select is(private.reserve_embryo_ingest_chunk_v1((select id from attempt),0,repeat('d',64),100,2,60,pg_temp.fragments())->>'status',
  'reserved','exact declared capacity is allowed');
select is(private.commit_embryo_ingest_chunk_v1((select id from attempt),0,repeat('d',64))->>'status','stored','capacity fixture commits');
select is(private.reserve_embryo_ingest_chunk_v1((select id from attempt),1,repeat('e',64),1,0,1,'[]')->>'status',
  'failure_pending','cumulative capacity is authoritative');
select is((select accepted_bytes from public.embryo_ingest_sessions where id=(select id from attempt)),
  100::bigint,'rejected capacity does not alter the reserved count');

-- Auth and lifecycle changes between reservation and commit publish nothing.
update attempt set id=pg_temp.new_attempt();
select is(private.reserve_embryo_ingest_chunk_v1((select id from attempt),0,repeat('d',64),100,2,60,pg_temp.fragments())->>'status',
  'reserved','auth-revocation fixture reserves');
update public.profiles set auth_session_revision=2 where id='7b000000-0000-4000-8000-000000000001';
select is(private.commit_embryo_ingest_chunk_v1((select id from attempt),0,repeat('d',64))->>'status',
  'failure_pending','account-session revocation prevents commit');
select is((select state from public.embryo_ingest_chunks where session_id=(select id from attempt)),
  'reserved','revoked attempt remains an unreadable pending object set');
update public.profiles set auth_session_revision=1 where id='7b000000-0000-4000-8000-000000000001';

update attempt set id=pg_temp.new_attempt();
update public.embryo_cohorts set basis_revision=2 where id=(select cohort_id from public.embryo_ingest_sessions where id=(select id from attempt));
select is(private.reserve_embryo_ingest_chunk_v1((select id from attempt),0,repeat('d',64),100,2,60,pg_temp.fragments())->>'status',
  'failure_pending','changed basis denies the next reservation');

update attempt set id=pg_temp.new_attempt();
update public.retention_due_phases set phase_revision=2 where target_id=(select id from attempt);
select is(private.reserve_embryo_ingest_chunk_v1((select id from attempt),0,repeat('d',64),100,2,60,pg_temp.fragments())->>'status',
  'failure_pending','a replacement due phase is not accepted');

update attempt set id=pg_temp.new_attempt();
update public.retention_due_phases set immutable_envelope='{}' where target_id=(select id from attempt);
select is(private.reserve_embryo_ingest_chunk_v1((select id from attempt),0,repeat('d',64),100,2,60,pg_temp.fragments())->>'status',
  'failure_pending','a changed due envelope cannot authorize writes');

update attempt set id=pg_temp.new_attempt();
update public.embryo_ingest_sessions set accepted_records=9999999 where id=(select id from attempt);
select is(private.reserve_embryo_ingest_chunk_v1((select id from attempt),0,repeat('d',64),100,2,60,pg_temp.fragments())->>'status',
  'failure_pending','the cumulative logical-record limit is enforced');

update attempt set id=pg_temp.new_attempt();
do $$
declare v_id uuid := (select id from attempt); v_i integer;
begin
  for v_i in 0..49 loop
    if private.reserve_embryo_ingest_chunk_v1(v_id,v_i,repeat('d',64),1,0,1,'[]')->>'status' <> 'reserved'
      or private.commit_embryo_ingest_chunk_v1(v_id,v_i,repeat('d',64))->>'status' <> 'stored'
    then raise exception 'the fifty-chunk boundary fixture failed'; end if;
  end loop;
end;
$$;
select is((select accepted_chunks from public.embryo_ingest_sessions where id=(select id from attempt)),50,
  'fifty contiguous chunks fit the boundary');
select is(private.reserve_embryo_ingest_chunk_v1((select id from attempt),50,repeat('d',64),1,0,1,'[]')->>'status',
  'failure_pending','a fifty-first chunk fails before any object reservation');
select is((select count(*) from public.embryo_ingest_chunks where session_id=(select id from attempt)),50::bigint,
  'quota failure leaves exactly the fifty retry-authority receipts');

update attempt set id=pg_temp.new_attempt();
update public.embryo_ingest_sessions set account_auth_session_revision=null where id=(select id from attempt);
select is(private.reserve_embryo_ingest_chunk_v1((select id from attempt),0,repeat('d',64),100,2,60,pg_temp.fragments())->>'status',
  'failure_pending','a legacy session without an auth revision is denied');

update attempt set id=pg_temp.new_attempt();
update public.profiles set non_self_upload_suspended_at=clock_timestamp() where id='7b000000-0000-4000-8000-000000000001';
select is(private.reserve_embryo_ingest_chunk_v1((select id from attempt),0,repeat('d',64),100,2,60,pg_temp.fragments())->>'status',
  'failure_pending','account suspension denies reservation');
update public.profiles set non_self_upload_suspended_at=null where id='7b000000-0000-4000-8000-000000000001';

update attempt set id=pg_temp.new_attempt();
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='7b000000-0000-4000-8000-000000000002';
select is(private.reserve_embryo_ingest_chunk_v1((select id from attempt),0,repeat('d',64),100,2,60,pg_temp.fragments())->>'status',
  'failure_pending','an expired originating session denies reservation');
update auth.sessions set not_after=null where id='7b000000-0000-4000-8000-000000000002';

update attempt set id=pg_temp.new_attempt();
delete from auth.sessions where id='7b000000-0000-4000-8000-000000000002';
select is(private.reserve_embryo_ingest_chunk_v1((select id from attempt),0,repeat('d',64),100,2,60,pg_temp.fragments())->>'status',
  'failure_pending','deleted originating session denies reservation');

select ok(not has_table_privilege('anon','public.embryo_ingest_chunks','SELECT'), 'anon cannot read receipts');
select ok(not has_table_privilege('authenticated','public.embryo_ingest_chunks','SELECT'), 'authenticated cannot read receipts');
select ok(not has_function_privilege('authenticated','private.reserve_embryo_ingest_chunk_v1(uuid,integer,text,integer,integer,integer,jsonb)','EXECUTE'),
  'target-capable reservation helper is not callable by a client');
select ok(not has_function_privilege('anon','private.commit_embryo_ingest_chunk_v1(uuid,integer,text)','EXECUTE'),
  'anon cannot commit a chunk');
select ok((select relrowsecurity from pg_class where oid='public.embryo_ingest_chunks'::regclass),'receipts have RLS');
select is((select count(*) from public.embryo_ingest_sessions where status='published'),0::bigint,'primitives never publish a session');
select is((select count(*) from public.retention_due_phases where retention_id='embryo.ingest-session-24h' and status <> 'pending'),
  0::bigint,'all failure fixtures preserve their exact pending due target');
select * from finish();
rollback;
