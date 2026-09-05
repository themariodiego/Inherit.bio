begin;
select no_plan();
\ir fixtures/embryo_cohort_pre_finalize.inc

create temporary table minted as select private.finalize_embryo_cohort_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),(select insurance from acks),(select charter from acks),
  'nonce-http-finalize-001','http://localhost:3000',true) as body;
create temporary table live as select s.* from public.embryo_ingest_sessions s
  where s.id=(select (body->'ingest'->>'session')::uuid from minted);
create function pg_temp.authorize_ingest(
  p_account uuid default '7a000000-0000-0000-0000-000000000001',
  p_auth uuid default '7a000000-0000-4000-8000-0000000000a1',
  p_cookie text default null, p_origin text default 'http://localhost:3000',
  p_test boolean default true
) returns jsonb language sql as $$
  select public.authorize_embryo_ingest_request_v1(p_account,p_auth,(select id from live),
    coalesce(p_cookie,(select cookie_hash from live)),p_origin,p_test)
$$;

select ok(not has_function_privilege('anon',
  'public.authorize_embryo_ingest_request_v1(uuid,uuid,uuid,text,text,boolean)','execute'),
  'anonymous cannot use the service authorizer');
select ok(not has_function_privilege('authenticated',
  'public.authorize_embryo_ingest_request_v1(uuid,uuid,uuid,text,text,boolean)','execute'),
  'signed-in clients cannot supply trusted account or auth-session claims');
select ok(has_function_privilege('service_role',
  'public.authorize_embryo_ingest_request_v1(uuid,uuid,uuid,text,text,boolean)','execute'),
  'only the server role can authorize a request');
select is(pg_temp.authorize_ingest()->>'status','authorized','matching live credential authorizes');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.authorize_ingest()) k),
  array['build','challenge','cohortId','expiresAt','format','handles','ingestRevision','sampleCount','session','status','transportRevision','uploadId'],
  'metadata has an exact closed internal shape');
select is(pg_temp.authorize_ingest()->>'sampleCount','3','all expected sample ordinals are bound');
select is(jsonb_array_length(pg_temp.authorize_ingest()->'handles'),3,'only current handle digests are returned');
select is(pg_temp.authorize_ingest()->'build','null'::jsonb,'unresolved build is never defaulted');
select is(pg_temp.authorize_ingest()->'format','null'::jsonb,'unresolved source format is never defaulted');
select ok(position((select body->'ingest'->>'cookieValue' from minted) in pg_temp.authorize_ingest()::text)=0,
  'authorization never returns a raw credential');
select throws_ok($$select pg_temp.authorize_ingest(p_account:='7a000000-0000-0000-0000-000000000002')$$,
  '42501','ingest unavailable','a different account is denied');
select throws_ok($$select pg_temp.authorize_ingest(p_auth:='7a000000-0000-4000-8000-0000000000a2')$$,
  '42501','ingest unavailable','another login for the same account is denied');
select throws_ok($$select pg_temp.authorize_ingest(p_cookie:=repeat('f',64))$$,
  '42501','ingest unavailable','a different cookie is denied');
select throws_ok($$select pg_temp.authorize_ingest(p_cookie:='invalid')$$,
  '42501','ingest unavailable','a malformed digest is denied');
select throws_ok($$select pg_temp.authorize_ingest(p_origin:='http://localhost:3001')$$,
  '42501','ingest unavailable','the mint origin cannot change');
select throws_ok($$select pg_temp.authorize_ingest(p_test:=false)$$,
  '42501','jurisdiction unavailable','the TEST-LOCAL gate is mandatory');
select throws_ok($$select pg_temp.authorize_ingest(p_test:=null)$$,
  '42501','jurisdiction unavailable','null is not a test-jurisdiction authorization');
select is((select to_jsonb(s) from public.embryo_ingest_sessions s where id=(select id from live)),
  (select to_jsonb(s) from live s),'credential denials and successful reads leave every session field unchanged');
select is((select count(*) from public.embryo_ingest_chunks),0::bigint,'authorization reserves no receipts');

create function pg_temp.changed_binding(p_sql text) returns text language plpgsql as $$
declare v_status text;
begin
  begin
    execute p_sql;
    v_status:=pg_temp.authorize_ingest()->>'status';
    raise exception using errcode='ZY001',message='rollback fixture';
  exception when sqlstate 'ZY001' then null;
  end;
  return v_status;
end;
$$;
select is(pg_temp.changed_binding($$insert into public.embryo_fragment_handle_maps
  (session_id,sample_ordinal,handle_hash,expires_at) select id,3,repeat('e',64),expires_at from live$$),
  'failure_pending','an extra handle outside the reserved ordinal set fails closed');
select is(pg_temp.changed_binding($$update public.embryo_fragment_handle_maps set consumed_at=clock_timestamp()
  where session_id=(select id from live) and sample_ordinal=0$$),
  'failure_pending','consumed handles cannot authorize new input');
select is(pg_temp.changed_binding($$update public.embryo_fragment_handle_maps set expires_at=expires_at+interval '1 minute'
  where session_id=(select id from live) and sample_ordinal=0$$),
  'failure_pending','handle expiry must equal the fixed session deadline');

-- Real session revocation, unlike a wrong caller credential, denies the attempt
-- durably while preserving its fixed retry target and provisional graph.
delete from auth.sessions where id='7a000000-0000-4000-8000-0000000000a1';
select is(pg_temp.authorize_ingest(),jsonb_build_object('status','failure_pending',
  'cohortId',(select cohort_id from live),'ingestRevision',(select ingest_revision from live)),
  'revocation returns only the exact unwind dispatch envelope');
select is((select failure_code from public.embryo_ingest_sessions where id=(select id from live)),
  'authenticated-session-revocation','revocation has a closed failure reason');
select is(pg_temp.authorize_ingest()->>'status','failure_pending','repeat denial retains the same retry authority');
select ok(exists(select 1 from public.retention_rows r join public.retention_due_phases d on d.retention_row_id=r.id
  where r.target_id=(select id from live) and r.fixed_deadline=(select expires_at from live)
    and d.phase_deadline=(select expires_at from live) and d.status='pending'),
  'denial preserves the original due phase and absolute deadline');
select is((select count(*) from public.embryo_fragment_handle_maps where session_id=(select id from live)),
  3::bigint,'denial never removes handle retry targets before unwind');

select * from finish();
rollback;
