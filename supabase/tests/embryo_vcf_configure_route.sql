begin;
select no_plan();
\ir fixtures/embryo_cohort_pre_finalize.inc

-- ADR 0035: the configure transaction behind api.embryo-ingest-configure.
-- The fixture cohort has three embryos. Values the route would generate
-- (challenge, nonces) are synthetic constants here.
create temporary table minted as select private.finalize_embryo_cohort_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),(select insurance from acks),(select charter from acks),
  'nonce-vcf-configure-finalize','http://localhost:3000',true) as body;
create temporary table live as select s.* from public.embryo_ingest_sessions s
  where s.id=(select (body->'ingest'->>'session')::uuid from minted);
grant select on minted,live to service_role;

create function pg_temp.configure_vcf(
  p_account uuid default '7a000000-0000-0000-0000-000000000001',
  p_auth uuid default '7a000000-0000-4000-8000-0000000000a1',p_cookie text default null,
  p_cohort uuid default null,p_build text default 'GRCh38',p_count bigint default 3,
  p_nonce text default 'nonce-vcf-configure-001',p_challenge text default repeat('Q',43),
  p_completion text default 'nonce-vcf-complete-001',p_csrf text default 'nonce-vcf-csrf-00001',
  p_test boolean default true
) returns jsonb language sql as $$
  select public.configure_embryo_vcf_ingest_v1(p_account,p_auth,(select id from live),
    coalesce(p_cookie,(select cookie_hash from live)),'http://localhost:3000',
    coalesce(p_cohort,(select cohort_id from live)),(select ingest_revision from live),
    p_build,p_count,p_nonce,p_challenge,p_completion,p_csrf,p_test)
$$;
create function pg_temp.authorize() returns jsonb language sql as $$
  select public.authorize_embryo_ingest_request_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',(select id from live),(select cookie_hash from live),
    'http://localhost:3000',true)
$$;
-- Runs a probe and rolls its effects back, keeping the successful fixture.
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
create function pg_temp.sha(p text) returns text language sql as $$
  select encode(extensions.digest(convert_to(p,'UTF8'),'sha256'),'hex')
$$;

-- Privileges: the one door is service-only; the private body is a definer
-- with an empty search path and a bounded lock wait.
select ok(not has_function_privilege(r,f,'execute'),r||' cannot execute '||f)
from unnest(array['anon','authenticated','inherit_upload_only']) r
cross join unnest(array[
  'public.configure_embryo_vcf_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,bigint,text,text,text,text,boolean)',
  'private.configure_embryo_vcf_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,bigint,text,text,text,text,boolean)']) f;
select ok(has_function_privilege('service_role',
  'public.configure_embryo_vcf_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,bigint,text,text,text,text,boolean)','execute'),
  'the server role reaches the configure door');
select ok((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where
  oid='public.configure_embryo_vcf_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,bigint,text,text,text,text,boolean)'::regprocedure),
  'the public door is an invoker with an empty search path');
select ok((select prosecdef and proconfig @> array['search_path=""','lock_timeout=250ms'] from pg_proc where
  oid='private.configure_embryo_vcf_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,bigint,text,text,text,text,boolean)'::regprocedure),
  'the private body is a definer with an empty search path and a bounded lock wait');

-- The authorizer's closed shape now carries a digest, never a raw challenge.
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.authorize()) k),
  array['build','challengeHash','cohortId','expiresAt','format','handles','ingestRevision','sampleCount','session','status','transportRevision','uploadId'],
  'authorization metadata has an exact closed shape with a challenge digest');
select is(pg_temp.authorize()->'challengeHash','null'::jsonb,'no transport challenge is issued before configuration');
select ok(position((select transport_challenge from live) in pg_temp.authorize()::text)=0,
  'the challenge minted with the session is never returned');

-- Credential and argument denials change nothing.
select throws_ok($$select pg_temp.configure_vcf(p_account:='7a000000-0000-0000-0000-000000000002')$$,
  '42501','ingest unavailable','another account cannot configure this session');
select throws_ok($$select pg_temp.configure_vcf(p_auth:='7a000000-0000-4000-8000-0000000000b1')$$,
  '42501','ingest unavailable','another login cannot configure this session');
select throws_ok($$select pg_temp.configure_vcf(p_cookie:=repeat('f',64))$$,
  '42501','ingest unavailable','a wrong cookie cannot configure this session');
select throws_ok($$select pg_temp.configure_vcf(p_cohort:='7a000000-0000-0000-0000-000000000099')$$,
  '42501','ingest unavailable','a different expected cohort cannot touch the real session');
select throws_ok($$select pg_temp.configure_vcf(p_test:=false)$$,
  '42501','jurisdiction unavailable','configuration cannot run outside TEST-LOCAL');
select throws_ok($$select pg_temp.configure_vcf(p_build:='unknown')$$,
  '22023','invalid ingest configuration','only GRCh37, GRCh38 or no build reaches the database');
select throws_ok($$select pg_temp.configure_vcf(p_build:='hg19')$$,
  '22023','invalid ingest configuration','a source spelling of a build is never recorded');
select throws_ok($$select pg_temp.configure_vcf(p_count:=0)$$,
  '22023','invalid ingest configuration','a sample count must be positive');
select throws_ok($$select pg_temp.configure_vcf(p_challenge:='short')$$,
  '22023','invalid ingest configuration','the challenge has the transport shape');
select throws_ok($$select pg_temp.configure_vcf(p_csrf:='nonce-vcf-complete-001')$$,
  '22023','invalid ingest configuration','the CSRF token and the completion nonce are distinct');
select throws_ok($$select pg_temp.configure_vcf(p_completion:='nonce-vcf-configure-001')$$,
  '22023','invalid ingest configuration','the completion nonce is not the operation nonce');
select is((select to_jsonb(s) from public.embryo_ingest_sessions s where id=(select id from live)),
  (select to_jsonb(s) from live s),'every denial preserves the complete session');
select is((select count(*) from public.embryo_operation_nonces where operation='ingest_configure'),
  0::bigint,'no denial consumes the operation nonce');

-- Terminal branches, each probed and rolled back.
select is(pg_temp.probe('select 1',$$select pg_temp.configure_vcf(p_build:=null)$$),
  jsonb_build_object('status','terminal','branch','build_unknown',
    'cohortId',(select cohort_id from live),'ingestRevision',(select ingest_revision from live)),
  'an absent or conflicting header build is terminal build_unknown');
select is(pg_temp.probe('select 1',$$select pg_temp.configure_vcf(p_build:=null,p_count:=1)$$)->>'branch',
  'build_unknown','the header build is decided before the sample count');
select is(pg_temp.probe('select 1',$$select pg_temp.configure_vcf(p_count:=1)$$)->>'branch',
  'cohort_single_sample','one sample column is cohort_single_sample');
select is(pg_temp.probe('select 1',$$select pg_temp.configure_vcf(p_count:=2)$$)->>'branch',
  'sample_count_mismatch','fewer columns than embryos is a mismatch');
select is(pg_temp.probe('select 1',$$select pg_temp.configure_vcf(p_count:=4)$$)->>'branch',
  'sample_count_mismatch','more columns than embryos is a mismatch');
select is(pg_temp.probe('select 1',$$select pg_temp.configure_vcf(p_count:=9007199254740991)$$)->>'branch',
  'sample_count_mismatch','the largest safe count is a mismatch, not an error');
-- The branch is taken in its own statement so the reads below see its writes.
select is(pg_temp.probe(
  'create temporary table probe_branch as select pg_temp.configure_vcf(p_build:=null) as body',
  $$select jsonb_build_object(
    'branch',(select body->>'branch' from probe_branch),
    'session',(select jsonb_build_object('status',status,'failure',failure_code,'format',source_format,
      'build',reference_build,'challenge',transport_challenge_hash,'expires',expires_at=(select expires_at from live))
      from public.embryo_ingest_sessions where id=(select id from live)),
    'nonce',(select count(*) from public.embryo_operation_nonces where operation='ingest_configure'
      and target_kind='ingest_session' and target_id=(select id from live)
      and nonce_hash=pg_temp.sha('nonce-vcf-configure-001')),
    'due',(select count(*) from public.retention_rows r join public.retention_due_phases d on d.retention_row_id=r.id
      where r.target_id=(select id from live) and r.fixed_deadline=(select expires_at from live)
      and d.status='pending'),
    'handles',(select count(*) from public.embryo_fragment_handle_maps where session_id=(select id from live)),
    'after',pg_temp.authorize()->>'status',
    'unwind',public.prepare_embryo_ingest_unwind_v1((select cohort_id from live),(select ingest_revision from live))->>'status'
  )$$),
  jsonb_build_object('branch','build_unknown',
    'session',jsonb_build_object('status','failure_pending','failure','build','format',null,'build',null,
      'challenge',null,'expires',true),
    'nonce',1,'due',1,'handles',3,'after','failure_pending','unwind','storage_pending'),
  'a terminal branch consumes the nonce, marks failure-pending with a closed reason, issues nothing, preserves the session, due target and handles, and leaves the attempt to the one unwind');
select is(pg_temp.probe(
  'create temporary table probe_count as select pg_temp.configure_vcf(p_count:=2) as body',
  $$select jsonb_build_object('branch',(select body->>'branch' from probe_count),
    'failure',(select failure_code from public.embryo_ingest_sessions where id=(select id from live)))$$),
  jsonb_build_object('branch','sample_count_mismatch','failure','header'),
  'a sample-count branch fails the attempt as a header failure');
select is(pg_temp.probe($$select pg_temp.configure_vcf(p_count:=2)$$,
    $$select pg_temp.configure_vcf(p_nonce:='nonce-vcf-configure-002')$$),
  jsonb_build_object('status','failure_pending','cohortId',(select cohort_id from live),
    'ingestRevision',(select ingest_revision from live)),
  'after a terminal branch the attempt configures nothing, even with a fresh nonce');
select is(pg_temp.probe($$delete from auth.sessions where id='7a000000-0000-4000-8000-0000000000a1'$$,
    $$select pg_temp.configure_vcf()$$)->>'status',
  'failure_pending','a revoked login fails the attempt instead of configuring it');

-- Success, through the door as the server role.
set local role service_role;
create temporary table configured as select public.configure_embryo_vcf_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',(select id from live),
  (select cookie_hash from live),'http://localhost:3000',(select cohort_id from live),
  (select ingest_revision from live),'GRCh38',3,'nonce-vcf-configure-001',repeat('Q',43),
  'nonce-vcf-complete-001','nonce-vcf-csrf-00001',true) as body;
reset role;
select is((select body->>'status' from configured),'configured','a matching header build and count configure the session');
select is((select body->>'build' from configured),'GRCh38','the answer carries the server-derived build');
select ok((select (body->>'revision')::bigint between 2 and 281474976710657 from configured),
  'the revision is random, positive, safe and never the minted 1');
select is((select jsonb_build_object('format',source_format,'build',reference_build,'configured',configured_build,
    'evidence',build_evidence,'status',status,'nonce',configuration_nonce_hash,'raw',transport_challenge,
    'challenge',transport_challenge_hash,'completion',issued_completion_nonce_hash,'csrf',issued_csrf_hash,
    'revision',transport_revision)
  from public.embryo_ingest_sessions where id=(select id from live)),
  jsonb_build_object('format','vcf','build','GRCh38','configured','GRCh38','evidence','explicit-header',
    'status','open','nonce',pg_temp.sha('nonce-vcf-configure-001'),'raw',null,
    'challenge',pg_temp.sha(repeat('Q',43)),'completion',pg_temp.sha('nonce-vcf-complete-001'),
    'csrf',pg_temp.sha('nonce-vcf-csrf-00001'),'revision',(select (body->>'revision')::bigint from configured)),
  'format and build are recorded once, and the challenge and both tokens are stored as digests only');
select ok((select position(repeat('Q',43) in to_jsonb(s)::text)=0 and position('nonce-vcf-complete-001' in to_jsonb(s)::text)=0
    and position('nonce-vcf-csrf-00001' in to_jsonb(s)::text)=0 and position((select transport_challenge from live) in to_jsonb(s)::text)=0
  from public.embryo_ingest_sessions s where id=(select id from live)),
  'no raw challenge or token survives in the session row');
select is((select count(*) from public.embryo_operation_nonces where operation='ingest_configure'
  and nonce_hash=pg_temp.sha('nonce-vcf-configure-001')),1::bigint,'the operation nonce is consumed exactly once');
select is(pg_temp.authorize()->>'challengeHash',pg_temp.sha(repeat('Q',43)),
  'every later request is authorized against the issued challenge digest');
select is(pg_temp.authorize()->>'transportRevision',(select body->>'revision' from configured),
  'and against the issued revision');
select is(pg_temp.authorize()->>'build','GRCh38','and against the recorded build');

-- Retries.
select is(pg_temp.configure_vcf(),(select body from configured),'an exact retry of the same values is idempotent');
select is((select count(*) from public.embryo_operation_nonces where operation='ingest_configure'),
  1::bigint,'the retry consumes nothing');
select throws_ok($$select pg_temp.configure_vcf(p_challenge:=repeat('R',43))$$,
  '55000','ingest configuration already fixed','the same nonce cannot issue a second challenge');
select throws_ok($$select pg_temp.configure_vcf(p_nonce:='nonce-vcf-configure-003')$$,
  '55000','ingest configuration already fixed','a fresh nonce cannot configure the session again');
select throws_ok($$select pg_temp.configure_vcf(p_build:='GRCh37')$$,
  '55000','ingest configuration already fixed','a retry cannot substitute another build');
select throws_ok($$select pg_temp.configure_vcf(p_count:=2,p_nonce:='nonce-vcf-configure-004')$$,
  '55000','ingest configuration already fixed','a configured session cannot be failed through this door');
select throws_ok($$select private.configure_embryo_ingest_session_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select id from live),(select cookie_hash from live),'http://localhost:3000',
  (select cohort_id from live),(select ingest_revision from live),'pgt_table',null,'decision-required',
  'nonce-vcf-configure-005',true)$$,
  '55000','ingest configuration already fixed','the table configuration path cannot overwrite a VCF configuration');

-- Write-once issuance.
select throws_ok($$update public.embryo_ingest_sessions set transport_challenge_hash=repeat('a',64)
  where id=(select id from live)$$,'55000','immutable ingest transport','the challenge digest cannot be swapped');
select throws_ok($$update public.embryo_ingest_sessions set transport_revision=transport_revision+1
  where id=(select id from live)$$,'55000','immutable ingest transport','the revision cannot be bumped');
select throws_ok($$update public.embryo_ingest_sessions set issued_completion_nonce_hash=repeat('b',64)
  where id=(select id from live)$$,'55000','immutable ingest transport','the completion nonce cannot be swapped');
select throws_ok($$update public.embryo_ingest_sessions set issued_csrf_hash=repeat('c',64)
  where id=(select id from live)$$,'55000','immutable ingest transport','the CSRF token cannot be swapped');
select throws_ok($$update public.embryo_ingest_sessions set transport_challenge=repeat('D',43)
  where id=(select id from live)$$,'55000','immutable ingest transport','a raw challenge cannot be restored');
select throws_ok($$update public.embryo_ingest_sessions set reference_build='GRCh37'
  where id=(select id from live)$$,'55000','immutable ingest configuration','the recorded build is write-once');

-- Nothing beyond configuration happened.
select is((select expires_at from public.embryo_ingest_sessions where id=(select id from live)),
  (select expires_at from live),'configuration never renews the session deadline');
select ok(exists(select 1 from public.retention_rows r join public.retention_due_phases d on d.retention_row_id=r.id
  where r.target_id=(select id from live) and r.fixed_deadline=(select expires_at from live)
  and d.phase_deadline=(select expires_at from live) and d.status='pending'),
  'the original due target and absolute deadline remain scheduled');
select is((select count(*) from public.embryo_ingest_chunks where session_id=(select id from live)),0::bigint,
  'configuration reserves no chunk');
select is((select count(*) from public.embryo_ingest_fragments where session_id=(select id from live)),0::bigint,
  'configuration writes no fragment');
select is((select count(*) from public.embryo_mapping_challenges where ingest_session_id=(select id from live)),0::bigint,
  'a VCF configuration issues no mapping challenge');
select is((select count(*) from public.worker_jobs where kind='split_cohort_vcf'),0::bigint,
  'configuration enqueues no sanitization job');

select * from finish();
rollback;
