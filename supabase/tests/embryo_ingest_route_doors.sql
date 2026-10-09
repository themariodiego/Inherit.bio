begin;
select no_plan();
\ir fixtures/embryo_cohort_pre_finalize.inc

-- The chunk and completion routes' two credential-bound doors. Needs
-- 20260929110000_embryo_vcf_configure_route.sql for the issued-token digests.
create temporary table minted as select private.finalize_embryo_cohort_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),(select insurance from acks),(select charter from acks),
  'nonce-route-doors-finalize','http://localhost:3000',true) as body;
create temporary table live as select s.* from public.embryo_ingest_sessions s
  where s.id=(select (body->'ingest'->>'session')::uuid from minted);

create function pg_temp.sha(p text) returns text language sql as $$
  select encode(extensions.digest(convert_to(p,'UTF8'),'sha256'),'hex')
$$;
create function pg_temp.fail(
  p_code text default 'header',p_account uuid default '7a000000-0000-0000-0000-000000000001',
  p_cookie text default null,p_cohort uuid default null,p_test boolean default true
) returns jsonb language sql as $$
  select public.fail_embryo_ingest_attempt_v1(p_account,'7a000000-0000-4000-8000-0000000000a1',
    (select id from live),coalesce(p_cookie,(select cookie_hash from live)),'http://localhost:3000',
    coalesce(p_cohort,(select cohort_id from live)),(select ingest_revision from live),p_code,p_test)
$$;
create function pg_temp.issued(
  p_completion text default pg_temp.sha('nonce-doors-complete-01'),p_csrf text default pg_temp.sha('nonce-doors-csrf-000001'),
  p_account uuid default '7a000000-0000-0000-0000-000000000001',p_cookie text default null,p_test boolean default true
) returns boolean language sql as $$
  select public.embryo_ingest_issued_tokens_match_v1(p_account,'7a000000-0000-4000-8000-0000000000a1',
    (select id from live),coalesce(p_cookie,(select cookie_hash from live)),'http://localhost:3000',
    p_completion,p_csrf,p_test)
$$;
create function pg_temp.probe(p_sql text,p_call text) returns jsonb language plpgsql as $$
declare result jsonb;
begin
 begin
  execute p_sql;
  execute p_call into result;
  raise exception using errcode='ZY001',message='restore synthetic probe';
 exception when sqlstate 'ZY001' then null;
 end;
 return result;
end $$;

-- Privileges.
select ok(not has_function_privilege(r,f,'execute'),r||' cannot execute '||f)
from unnest(array['anon','authenticated','inherit_upload_only']) r
cross join unnest(array[
  'public.fail_embryo_ingest_attempt_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,boolean)',
  'private.fail_embryo_ingest_attempt_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,boolean)',
  'public.embryo_ingest_issued_tokens_match_v1(uuid,uuid,uuid,text,text,text,text,boolean)',
  'private.embryo_ingest_issued_tokens_match_v1(uuid,uuid,uuid,text,text,text,text,boolean)']) f;
select ok(has_function_privilege('service_role',f,'execute'),'the server role reaches '||f)
from unnest(array[
  'public.fail_embryo_ingest_attempt_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,boolean)',
  'public.embryo_ingest_issued_tokens_match_v1(uuid,uuid,uuid,text,text,text,text,boolean)']) f;
select ok((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=f::regprocedure),
  f||' is an invoker door with an empty search path')
from unnest(array[
  'public.fail_embryo_ingest_attempt_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,boolean)',
  'public.embryo_ingest_issued_tokens_match_v1(uuid,uuid,uuid,text,text,text,text,boolean)']) f;
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=f::regprocedure),
  f||' is a definer with an empty search path')
from unnest(array[
  'private.fail_embryo_ingest_attempt_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,boolean)',
  'private.embryo_ingest_issued_tokens_match_v1(uuid,uuid,uuid,text,text,text,text,boolean)']) f;

-- The failure door: closed codes, credential-bound, TEST-LOCAL only.
select throws_ok($$select pg_temp.fail(c) from unnest(array['quota']) c$$,'22023','invalid ingest failure',
  'quota is the database''s own decision, never a route''s');
select throws_ok($$select pg_temp.fail('expiry')$$,'22023','invalid ingest failure','expiry is not a route code');
select throws_ok($$select pg_temp.fail(null)$$,'22023','invalid ingest failure','a code is required');
select throws_ok($$select pg_temp.fail(p_account:='7a000000-0000-0000-0000-000000000002')$$,
  '42501','ingest unavailable','another account cannot fail this attempt');
select throws_ok($$select pg_temp.fail(p_cookie:=repeat('f',64))$$,
  '42501','ingest unavailable','a wrong cookie cannot fail this attempt');
select throws_ok($$select pg_temp.fail(p_cohort:='7a000000-0000-0000-0000-000000000099')$$,
  '42501','ingest unavailable','a different expected cohort cannot touch the real attempt');
select throws_ok($$select pg_temp.fail(p_test:=false)$$,'42501','jurisdiction unavailable',
  'the door cannot run outside TEST-LOCAL');
select is((select to_jsonb(s) from public.embryo_ingest_sessions s where id=(select id from live)),
  (select to_jsonb(s) from live s),'every refusal leaves the attempt untouched');

select is(pg_temp.probe('create temporary table probe_fail as select c, pg_temp.fail(c) as body from unnest(array[''abort'']) c',
  $$select jsonb_build_object('body',(select body from probe_fail),
    'status',(select status from public.embryo_ingest_sessions where id=(select id from live)),
    'failure',(select failure_code from public.embryo_ingest_sessions where id=(select id from live)),
    'expires',(select expires_at=(select expires_at from live) from public.embryo_ingest_sessions where id=(select id from live)),
    'handles',(select count(*) from public.embryo_fragment_handle_maps where session_id=(select id from live)),
    'due',(select count(*) from public.retention_rows r join public.retention_due_phases d on d.retention_row_id=r.id
      where r.target_id=(select id from live) and r.fixed_deadline=(select expires_at from live) and d.status='pending'),
    'again',pg_temp.fail('header'),
    'unwind',public.prepare_embryo_ingest_unwind_v1((select cohort_id from live),(select ingest_revision from live))->>'status')$$),
  jsonb_build_object(
    'body',jsonb_build_object('status','failure_pending','cohortId',(select cohort_id from live),'ingestRevision',(select ingest_revision from live)),
    'status','failure_pending','failure','abort','expires',true,'handles',3,'due',1,
    'again',jsonb_build_object('status','failure_pending','cohortId',(select cohort_id from live),'ingestRevision',(select ingest_revision from live)),
    'unwind','storage_pending'),
  'a route failure marks the attempt with its closed code, keeps the session, handles and due target, repeats idempotently and leaves the attempt to the one unwind');
select is(pg_temp.probe('select 1',$$select to_jsonb(array_agg(pg_temp.fail(c)->>'status' order by c))
    from unnest(array['chunk','format','header','limit']) c$$),
  '["failure_pending","failure_pending","failure_pending","failure_pending"]'::jsonb,
  'every route-decided code is accepted');

-- The issued-token check.
select is(pg_temp.issued(),false,'no token matches before configuration issued any');
select is(public.configure_embryo_vcf_ingest_v1('7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',(select id from live),(select cookie_hash from live),
  'http://localhost:3000',(select cohort_id from live),(select ingest_revision from live),'GRCh38',3,
  'nonce-doors-configure-01',repeat('Q',43),'nonce-doors-complete-01','nonce-doors-csrf-000001',true)->>'status',
  'configured','the fixture session is configured');
select is(pg_temp.issued(),true,'the exact issued completion nonce and CSRF token match');
select is(pg_temp.issued(p_completion:=pg_temp.sha('nonce-doors-complete-02')),false,'another completion nonce does not');
select is(pg_temp.issued(p_csrf:=pg_temp.sha('nonce-doors-csrf-000002')),false,'another CSRF token does not');
select is(pg_temp.issued(pg_temp.sha('nonce-doors-csrf-000001'),pg_temp.sha('nonce-doors-complete-01')),false,
  'the two tokens cannot stand in for each other');
select is(pg_temp.issued(p_account:='7a000000-0000-0000-0000-000000000002'),false,'another account learns nothing');
select is(pg_temp.issued(p_cookie:=repeat('f',64)),false,'a wrong cookie learns nothing');
select is(pg_temp.issued(p_completion:='not-a-digest'),false,'a malformed digest is simply false');
select throws_ok($$select pg_temp.issued(p_test:=false)$$,'42501','jurisdiction unavailable',
  'the check cannot run outside TEST-LOCAL');
select is((select status from public.embryo_ingest_sessions where id=(select id from live)),'open',
  'the check marks nothing');

select * from finish();
rollback;
