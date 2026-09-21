begin;
select no_plan();
\ir fixtures/embryo_cohort_pre_finalize.inc

-- The wrapper exists with the private function's exact signature. A drift in
-- either direction would leave the route calling something else.
select has_function('public','finalize_embryo_cohort_ingest_v1',
  array['uuid','uuid','uuid','uuid','uuid','text','text','boolean'],
  'the cohort-finalize transaction has a public door');

-- The two barriers, asserted separately because either alone would be enough
-- to stop a client and neither alone is the design.
select ok(not has_function_privilege('anon',
  'public.finalize_embryo_cohort_ingest_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean)','execute'),
  'anonymous cannot finalize a cohort');
select ok(not has_function_privilege('authenticated',
  'public.finalize_embryo_cohort_ingest_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean)','execute'),
  'a signed-in client cannot supply its own account or auth-session claims');
select ok(has_function_privilege('service_role',
  'public.finalize_embryo_cohort_ingest_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean)','execute'),
  'only the server role can finalize a cohort');
select ok(not has_function_privilege('anon',
  'private.finalize_embryo_cohort_ingest_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean)','execute'),
  'the inner transaction stays closed to anonymous even through an invoker wrapper');
select ok(not has_function_privilege('authenticated',
  'private.finalize_embryo_cohort_ingest_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean)','execute'),
  'the inner transaction stays closed to signed-in clients even through an invoker wrapper');

-- Invoker, not definer: the wrapper must carry no privilege of its own, or
-- the revoke above would be the only thing standing between a client and the
-- private transaction.
select is((select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='finalize_embryo_cohort_ingest_v1'),
  false, 'the door carries no privilege of its own');
select ok((select 'search_path=""' = any(coalesce(proconfig,'{}')) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='finalize_embryo_cohort_ingest_v1'),
  'the door resolves nothing through a caller-controlled search path');

-- It delegates rather than reimplements. The jurisdiction guard is the first
-- statement of the private body, so reaching it proves the call arrives
-- there; a wrapper that had grown a check of its own would refuse earlier or
-- with a different code.
select throws_ok($$select public.finalize_embryo_cohort_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),(select insurance from acks),(select charter from acks),
  'nonce-public-door-000','http://localhost:3000',false)$$,
  '42501','jurisdiction unavailable',
  'the private jurisdiction guard is what refuses, not a copy of it');

-- And the successful path returns the same two halves the private
-- transaction returns, so the route can read one shape either way.
create temporary table minted_public as select public.finalize_embryo_cohort_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),(select insurance from acks),(select charter from acks),
  'nonce-public-door-001','http://localhost:3000',true) as body;
select ok((select body ? 'cohort' and body ? 'ingest' from minted_public),
  'the door returns the cohort and the ingest mint together');
select ok((select (body->'ingest') ? 'cookieValue' and (body->'ingest') ? 'session'
  and (body->'ingest') ? 'expiresAt' from minted_public),
  'the mint still carries the cookie value, session and expiry the route needs');
select is((select jsonb_array_length(body->'ingest'->'sampleHandles') from minted_public),
  (select (body->'cohort'->>'embryo_count')::int from minted_public),
  'one sample handle per embryo, which is what the chunk route will check');

select * from finish();
rollback;
