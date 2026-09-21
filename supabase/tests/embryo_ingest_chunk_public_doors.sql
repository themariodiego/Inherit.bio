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
select ok((select embryos from ingest) >= 1, 'the cohort has an ordinal a fragment could bind to');

-- The fragment path is closed, and not by either door. embryo_ingest_sessions
-- declares source_format and reference_build nullable (20260905192551:12-13);
-- private.bind_embryo_fragment_object_v1, the before-insert trigger on
-- embryo_ingest_fragments, refuses unless both are set (20260905203457:25-28);
-- and no migration, route or worker writes either one. So a reservation
-- carrying even a single fragment cannot succeed today, whichever door calls
-- it. The first attempt at this file assumed otherwise and failed in CI on
-- exactly this trigger. Asserted rather than stepped around, so the day a
-- writer exists these three lines fail and the fuller proof is restored.
select ok((select source_format from public.embryo_ingest_sessions
  where id=(select session from ingest)) is null,
  'the mint leaves source_format unset, because nothing writes it');
select ok((select reference_build from public.embryo_ingest_sessions
  where id=(select session from ingest)) is null,
  'the mint leaves reference_build unset, because nothing writes it');
select throws_ok(format($fragment$select public.reserve_embryo_ingest_chunk_v1(
  %L::uuid, 0, %L, 1024, 10, 200, jsonb_build_array(jsonb_build_object(
  'ordinal',0,'bytes',512,'lines',5,'sha256',%L)))$fragment$,
  (select session from ingest), repeat('a',64), repeat('b',64)),
  '55000','ingest object binding unavailable',
  'a fragment cannot bind while source_format and reference_build have no writer');

-- Delegation without a fragment, which the reservation accepts: an empty array
-- is a well-formed array, its length is under the cohort ordinal count, and the
-- per-fragment loop never runs, so no row reaches the trigger. The receipt row,
-- its state transition and the session's sequence are still written only by the
-- private transaction, which is what these doors are being held to.
create temporary table reserved as select public.reserve_embryo_ingest_chunk_v1(
  (select session from ingest), 0, repeat('a',64), 1024, 10, 200, '[]'::jsonb) as body;
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
