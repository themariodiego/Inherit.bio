begin;
select no_plan();
\ir fixtures/embryo_cohort_pre_finalize.inc

-- Both wrappers exist with their private function's exact signature. A drift
-- in either direction would leave the chunk route calling something else.
select has_function('public','reserve_embryo_ingest_chunk_v1',
  array['uuid','integer','text','integer','integer','integer','jsonb'],
  'chunk reservation has a public door');
select has_function('public','commit_embryo_ingest_chunk_v1',
  array['uuid','integer','text'],
  'chunk commit has a public door');

-- The barriers, asserted separately on both doors and on both private
-- functions: either alone would stop a client and neither alone is the design.
select ok(not has_function_privilege('anon',
  'public.reserve_embryo_ingest_chunk_v1(uuid,integer,text,integer,integer,integer,jsonb)','execute'),
  'anonymous cannot reserve a chunk');
select ok(not has_function_privilege('authenticated',
  'public.reserve_embryo_ingest_chunk_v1(uuid,integer,text,integer,integer,integer,jsonb)','execute'),
  'a signed-in client cannot reserve a chunk against a session it names itself');
select ok(has_function_privilege('service_role',
  'public.reserve_embryo_ingest_chunk_v1(uuid,integer,text,integer,integer,integer,jsonb)','execute'),
  'only the server role can reserve a chunk');
select ok(not has_function_privilege('anon',
  'public.commit_embryo_ingest_chunk_v1(uuid,integer,text)','execute'),
  'anonymous cannot commit a chunk');
select ok(not has_function_privilege('authenticated',
  'public.commit_embryo_ingest_chunk_v1(uuid,integer,text)','execute'),
  'a signed-in client cannot commit a chunk');
select ok(has_function_privilege('service_role',
  'public.commit_embryo_ingest_chunk_v1(uuid,integer,text)','execute'),
  'only the server role can commit a chunk');

-- `authenticated` holds USAGE on `private`, so the inner EXECUTE check is the
-- barrier that matters and an invoker wrapper is what keeps it in play.
select ok(not has_function_privilege('authenticated',
  'private.reserve_embryo_ingest_chunk_v1(uuid,integer,text,integer,integer,integer,jsonb)','execute'),
  'the inner reservation stays closed to signed-in clients even through an invoker wrapper');
select ok(not has_function_privilege('authenticated',
  'private.commit_embryo_ingest_chunk_v1(uuid,integer,text)','execute'),
  'the inner commit stays closed to signed-in clients even through an invoker wrapper');

-- Invoker, not definer: a definer door would carry its owner's privilege and
-- the revoke above would be the only thing standing between a client and the
-- private transaction.
select is((select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='reserve_embryo_ingest_chunk_v1'),
  false, 'the reservation door carries no privilege of its own');
select is((select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='commit_embryo_ingest_chunk_v1'),
  false, 'the commit door carries no privilege of its own');
select ok((select 'search_path=""' = any(coalesce(proconfig,'{}')) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='reserve_embryo_ingest_chunk_v1'),
  'the reservation door resolves nothing through a caller-controlled search path');
select ok((select 'search_path=""' = any(coalesce(proconfig,'{}')) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='commit_embryo_ingest_chunk_v1'),
  'the commit door resolves nothing through a caller-controlled search path');

-- Delegation, proved by a side effect rather than by a return shape: a door
-- that reimplemented anything could match a status string, but only the real
-- transaction lands the receipt row and advances the session's sequence.
create temporary table minted as select public.finalize_embryo_cohort_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),(select insurance from acks),(select charter from acks),
  'nonce-chunk-doors-001','http://localhost:3000',true) as body;
create temporary table ingest as select
  (body->'ingest'->>'session')::uuid as session,
  (body->'cohort'->>'embryo_count')::int as embryos from minted;

-- Stated rather than assumed, so a failure below points at the right thing.
select is((select expected_next_sequence from public.embryo_ingest_sessions
  where id=(select session from ingest)), 0,
  'a freshly minted session expects sequence zero');
select ok((select declared_capacity_bytes from public.embryo_ingest_sessions
  where id=(select session from ingest)) >= 1024,
  'the mint declared a capacity the reservation below fits inside');
select ok((select embryos from ingest) >= 1, 'the cohort has an ordinal to bind a fragment to');

create temporary table reserved as select public.reserve_embryo_ingest_chunk_v1(
  (select session from ingest), 0, repeat('a',64), 1024, 10, 200,
  jsonb_build_array(jsonb_build_object(
    'ordinal',0,'bytes',512,'lines',5,'sha256',repeat('b',64)))) as body;
select is((select body->>'status' from reserved), 'reserved',
  'the reservation door reserves');
select is((select content_sha256 from public.embryo_ingest_chunks
  where session_id=(select session from ingest) and sequence=0), repeat('a',64),
  'the receipt the private transaction writes is there, with the bytes it was told');

create temporary table committed as select public.commit_embryo_ingest_chunk_v1(
  (select session from ingest), 0, repeat('a',64)) as body;
select is((select body->>'status' from committed), 'stored', 'the commit door commits');
select is((select state from public.embryo_ingest_chunks
  where session_id=(select session from ingest) and sequence=0), 'stored',
  'the receipt moved to stored, which only the private transaction does');
select is((select expected_next_sequence from public.embryo_ingest_sessions
  where id=(select session from ingest)), 1,
  'the session advanced, so the next chunk cannot replay this one');

select * from finish();
rollback;
