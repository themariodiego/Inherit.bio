begin;
select no_plan();
\ir fixtures/embryo_cohort_pre_finalize.inc

-- ADR 0037 (owner decisions of 16 October 2026): the laboratory-table
-- configure, mapping inspection and decision transactions behind
-- api.embryo-ingest-configure and api.embryo-ingest-mapping, and the locus
-- read behind api.embryo-ingest-chunk. The fixture cohort has three
-- embryos. Values the routes would generate (challenges, nonces) are
-- synthetic constants here; no header string ever reaches these functions.
create temporary table minted as select private.finalize_embryo_cohort_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),(select insurance from acks),(select charter from acks),
  'nonce-table-mapping-finalize','http://localhost:3000',true) as body;
create temporary table live as select s.* from public.embryo_ingest_sessions s
  where s.id=(select (body->'ingest'->>'session')::uuid from minted);
grant select on minted,live to service_role;

create function pg_temp.configure_table(
  p_build text default null,p_nonce text default 'nonce-table-configure-01',
  p_mapping text default 'nonce-table-inspect-0001',p_account uuid default '7a000000-0000-0000-0000-000000000001',
  p_cookie text default null,p_test boolean default true
) returns jsonb language sql as $$
  select public.configure_embryo_table_ingest_v1(p_account,'7a000000-0000-4000-8000-0000000000a1',
    (select id from live),coalesce(p_cookie,(select cookie_hash from live)),'http://localhost:3000',
    (select cohort_id from live),(select ingest_revision from live),p_build,p_nonce,p_mapping,p_test)
$$;
create function pg_temp.inspect(
  p_outcome text default 'columns',p_count integer default 5,p_locus text default 'chrom-pos',
  p_nonce text default 'nonce-table-inspect-0001',p_challenge text default repeat('C',43),
  p_next text default 'nonce-table-decide-00001',p_completion text default null,p_csrf text default null,
  p_cookie text default null,p_test boolean default true
) returns jsonb language sql as $$
  select public.inspect_embryo_table_mapping_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',(select id from live),coalesce(p_cookie,(select cookie_hash from live)),
    'http://localhost:3000',(select cohort_id from live),(select ingest_revision from live),
    p_outcome,p_count,p_locus,p_nonce,p_challenge,p_next,p_completion,p_csrf,p_test)
$$;
create function pg_temp.decide(
  p_challenge text,p_resolution jsonb,p_nonce text,
  p_build_challenge text default null,p_build_nonce text default null,
  p_transport text default null,p_completion text default null,p_csrf text default null,
  p_cookie text default null
) returns jsonb language sql as $$
  select public.decide_embryo_table_mapping_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',(select id from live),coalesce(p_cookie,(select cookie_hash from live)),
    'http://localhost:3000',(select cohort_id from live),(select ingest_revision from live),
    p_challenge,p_resolution,p_nonce,p_build_challenge,p_build_nonce,p_transport,p_completion,p_csrf,true)
$$;
create function pg_temp.locus(p_cookie text default null,p_test boolean default true) returns text language sql as $$
  select public.embryo_ingest_table_locus_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',(select id from live),coalesce(p_cookie,(select cookie_hash from live)),
    'http://localhost:3000',p_test)
$$;
create function pg_temp.authorize_status() returns text language sql as $$
  select public.authorize_embryo_ingest_request_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',(select id from live),(select cookie_hash from live),
    'http://localhost:3000',true)->>'status'
$$;
create function pg_temp.session() returns jsonb language sql as $$
  select jsonb_build_object('status',status,'format',source_format,'build',reference_build,
    'configured',configured_build,'evidence',build_evidence,'locus',table_locus,'failure',failure_code,
    'mapping',issued_mapping_nonce_hash,'transport',transport_challenge_hash,'completion',issued_completion_nonce_hash,
    'csrf',issued_csrf_hash,'revision',transport_revision)
  from public.embryo_ingest_sessions where id=(select id from live)
$$;
-- Runs a probe and rolls its effects back, keeping the main line.
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

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege(r,f,'execute'),r||' cannot execute '||f)
from unnest(array['anon','authenticated','inherit_upload_only']) r
cross join unnest(array[
  'public.configure_embryo_table_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,text,text,boolean)',
  'private.configure_embryo_table_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,text,text,boolean)',
  'public.inspect_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,integer,text,text,text,text,text,text,boolean)',
  'private.inspect_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,integer,text,text,text,text,text,text,boolean)',
  'public.decide_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,jsonb,text,text,text,text,text,text,boolean)',
  'private.decide_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,jsonb,text,text,text,text,text,text,boolean)',
  'public.embryo_ingest_table_locus_v1(uuid,uuid,uuid,text,text,boolean)',
  'private.embryo_ingest_table_locus_v1(uuid,uuid,uuid,text,text,boolean)']) f;
select ok(not has_function_privilege('service_role',f,'execute'),'the server role cannot reach the internal '||f)
from unnest(array['private.issue_embryo_table_challenge_v1(uuid,text,integer,text,text,text,text)',
  'private.issue_embryo_table_transport_v1(uuid,text,text,text)']) f;
select ok(has_function_privilege('service_role',f,'execute'),'the server role reaches '||f)
from unnest(array[
  'public.configure_embryo_table_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,text,text,boolean)',
  'public.inspect_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,integer,text,text,text,text,text,text,boolean)',
  'public.decide_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,jsonb,text,text,text,text,text,text,boolean)',
  'public.embryo_ingest_table_locus_v1(uuid,uuid,uuid,text,text,boolean)']) f;
select ok((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=f::regprocedure),
  f||' is an invoker door with an empty search path')
from unnest(array[
  'public.configure_embryo_table_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,text,text,boolean)',
  'public.inspect_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,integer,text,text,text,text,text,text,boolean)',
  'public.decide_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,jsonb,text,text,text,text,text,text,boolean)',
  'public.embryo_ingest_table_locus_v1(uuid,uuid,uuid,text,text,boolean)']) f;
select ok((select prosecdef and proconfig @> array['search_path=""','lock_timeout=250ms'] from pg_proc where oid=f::regprocedure),
  f||' is a definer with an empty search path and a bounded lock wait')
from unnest(array[
  'private.configure_embryo_table_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,text,text,boolean)',
  'private.inspect_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,integer,text,text,text,text,text,text,boolean)',
  'private.decide_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,jsonb,text,text,text,text,text,text,boolean)']) f;
select ok((select prosecdef and provolatile='s' and proconfig @> array['search_path=""'] from pg_proc where
  oid='private.embryo_ingest_table_locus_v1(uuid,uuid,uuid,text,text,boolean)'::regprocedure),
  'the locus read is a stable definer that can write nothing');

-- No column can hold a header string: the two new session columns are a
-- digest and one closed canonical value.
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
  where table_schema='public' and table_name='embryo_ingest_sessions'
    and column_name in ('issued_mapping_nonce_hash','table_locus')),
  array['issued_mapping_nonce_hash','table_locus'],'the session gains exactly the inspection digest and the locus kind');
select throws_ok($$update public.embryo_ingest_sessions set table_locus='rsid' where id=(select id from live)$$,
  '23514',null,'a session that is not a table can hold no locus kind');

-- ---------------------------------------------------------------------------
-- Configure a laboratory table
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.configure_table(p_account:='7a000000-0000-0000-0000-000000000002')$$,
  '42501','ingest unavailable','another account cannot configure this session');
select throws_ok($$select pg_temp.configure_table(p_cookie:=repeat('f',64))$$,
  '42501','ingest unavailable','a wrong cookie cannot configure this session');
select throws_ok($$select pg_temp.configure_table(p_test:=false)$$,
  '42501','jurisdiction unavailable','table configuration cannot run outside TEST-LOCAL');
select throws_ok($$select pg_temp.configure_table(p_build:='hg19')$$,
  '22023','invalid ingest configuration','a source spelling of a build is never recorded');
select throws_ok($$select pg_temp.configure_table(p_build:='unknown')$$,
  '22023','invalid ingest configuration','an unknown build is not a build; the absence of one is null');
select throws_ok($$select pg_temp.configure_table(p_mapping:='nonce-table-configure-01')$$,
  '22023','invalid ingest configuration','the inspection nonce is not the operation nonce');
select throws_ok($$select pg_temp.configure_table(p_mapping:='short')$$,
  '22023','invalid ingest configuration','the inspection nonce has the nonce shape');
select is(pg_temp.session()->>'format',null,'every denial leaves the session unconfigured');
select is((select count(*) from public.embryo_operation_nonces where target_id=(select id from live)),0::bigint,
  'no denial consumes a nonce');

-- A header that states one build: explicit-header, probed and rolled back.
select is(pg_temp.probe('select 1',$$select pg_temp.configure_table(p_build:='GRCh37')||pg_temp.session()$$)
    - array['mapping','revision','transport','completion','csrf','failure'],
  jsonb_build_object('status','open','build','GRCh37','format','pgt_table','configured','GRCh37',
    'evidence','explicit-header','locus',null),
  'a stated header build is recorded as explicit-header');

-- No stated build: decision-required, with no build at all.
select is(pg_temp.configure_table(),jsonb_build_object('status','configured','build',null),
  'a header without a single stated build configures the session as decision-required');
select is(pg_temp.session() - array['revision'],jsonb_build_object('status','open','format','pgt_table','build',null,
    'configured',null,'evidence','decision-required','locus',null,'failure',null,
    'mapping',pg_temp.sha('nonce-table-inspect-0001'),'transport',null,'completion',null,'csrf',null),
  'format, decision-required evidence and the inspection digest are recorded, and nothing is inferred');
select is((select count(*) from public.embryo_operation_nonces where operation='ingest_configure'
  and nonce_hash=pg_temp.sha('nonce-table-configure-01')),1::bigint,'the operation nonce is consumed once');
select is(pg_temp.configure_table(),jsonb_build_object('status','configured','build',null),
  'an exact retry is idempotent');
select throws_ok($$select pg_temp.configure_table(p_mapping:='nonce-table-inspect-0002')$$,
  '55000','ingest configuration already fixed','a retry cannot swap the inspection nonce');
select throws_ok($$select pg_temp.configure_table(p_build:='GRCh38')$$,
  '55000','ingest configuration already fixed','a retry cannot substitute a build');
select throws_ok($$select public.configure_embryo_vcf_ingest_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',(select id from live),(select cookie_hash from live),'http://localhost:3000',
    (select cohort_id from live),(select ingest_revision from live),'GRCh38',3,'nonce-table-vcf-000001',repeat('Q',43),
    'nonce-table-vcfcomp-01','nonce-table-vcfcsrf-01',true)$$,
  '55000','ingest configuration already fixed','the VCF path cannot reconfigure a table');
select throws_ok($$update public.embryo_ingest_sessions set issued_mapping_nonce_hash=repeat('a',64)
  where id=(select id from live)$$,'55000','immutable table mapping','the inspection digest is write-once');
select is(pg_temp.locus(),null,'no locus is readable before the mapping is decided');

-- ---------------------------------------------------------------------------
-- Inspect the header copy
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.inspect(p_nonce:='nonce-table-inspect-0009')$$,
  '42501','mapping unavailable','only the inspection nonce configure issued inspects the session');
select throws_ok($$select pg_temp.inspect(p_cookie:=repeat('e',64))$$,
  '42501','ingest unavailable','a wrong cookie cannot inspect');
select throws_ok($$select pg_temp.inspect(p_test:=false)$$,
  '42501','jurisdiction unavailable','inspection cannot run outside TEST-LOCAL');
select throws_ok($$select pg_temp.inspect(p_outcome:='sex')$$,
  '22023','invalid mapping inspection','the outcome is closed');
select throws_ok($$select pg_temp.inspect(p_count:=129)$$,
  '22023','invalid mapping inspection','a column challenge counts at most 128 columns');
select throws_ok($$select pg_temp.inspect(p_locus:='sample')$$,
  '22023','invalid mapping inspection','the locus kind is rsid or chrom-pos only');
select throws_ok($$select pg_temp.inspect(p_outcome:='header')$$,
  '22023','invalid mapping inspection','a terminal outcome carries nothing derived from the header');
select throws_ok($$select pg_temp.inspect(p_next:='nonce-table-inspect-0001')$$,
  '22023','invalid mapping inspection','the decision nonce is not the inspection nonce');
select throws_ok($$select pg_temp.inspect(p_outcome:='transport',p_count:=null,p_next:=null,
    p_completion:='nonce-table-complete-01',p_csrf:='nonce-table-csrf-000001')$$,
  '55000','mapping inspection unavailable','a decision-required build cannot skip to the transport');
select is((select count(*) from public.embryo_operation_nonces where operation='ingest_mapping_inspect'),0::bigint,
  'no refused inspection consumes the nonce');

-- Terminal header outcomes, each probed and rolled back.
select is(pg_temp.probe('create temporary table probe_header as select pg_temp.inspect(p_outcome:=''header'',p_count:=null,p_locus:=null,p_challenge:=null,p_next:=null) as body',
  $$select (select body from probe_header)||jsonb_build_object('session',pg_temp.session()->>'status',
    'failure',pg_temp.session()->>'failure','locus',pg_temp.session()->>'locus',
    'challenges',(select count(*) from public.embryo_mapping_challenges where ingest_session_id=(select id from live)),
    'nonce',(select count(*) from public.embryo_operation_nonces where operation='ingest_mapping_inspect'),
    'due',(select count(*) from public.retention_rows r join public.retention_due_phases d on d.retention_row_id=r.id
      where r.target_id=(select id from live) and d.status='pending'),
    'handles',(select count(*) from public.embryo_fragment_handle_maps where session_id=(select id from live)))$$),
  jsonb_build_object('status','terminal','branch','header','cohortId',(select cohort_id from live),
    'ingestRevision',(select ingest_revision from live),'session','failure_pending','failure','header','locus',null,
    'challenges',0,'nonce',1,'due',1,'handles',3),
  'a forbidden column is terminal: the nonce is spent, the attempt is failure-pending, nothing derived is written, and the session, due target and handles are kept');
select is(pg_temp.probe('select 1',$$select pg_temp.inspect(p_outcome:='format',p_count:=null,p_locus:=null,p_challenge:=null,p_next:=null)
    ||jsonb_build_object('failure',pg_temp.session()->>'failure')$$)->>'failure',
  'format','a header that is not a table fails the attempt as a format failure');
select is(pg_temp.probe('select 1',$$select pg_temp.inspect(p_outcome:='mapping',p_count:=null,p_locus:=null,p_challenge:=null,p_next:=null)
    ||jsonb_build_object('failure',pg_temp.session()->>'failure')$$)->>'failure',
  'mapping','a header beyond four decisions fails the attempt as a mapping failure');

-- The column challenge.
create temporary table inspected as select pg_temp.inspect() as body;
select is((select body->>'status' from inspected),'challenge','an ambiguous header issues a challenge');
select is((select body->>'kind' from inspected),'columns','the challenge asks about columns');
select ok((select (body->>'revision')::bigint>0 and (body->>'expiresAt')::timestamptz<=(select expires_at from live) from inspected),
  'the challenge has a random positive revision and expires no later than the session');
select is((select jsonb_build_object('kind',challenge_kind,'count',column_count,'state',state,'challenge',challenge_hash,
    'inspection',inspection_nonce_hash,'decision',decision_nonce_hash,'transport',transport_revision)
  from public.embryo_mapping_challenges where ingest_session_id=(select id from live)),
  jsonb_build_object('kind','columns','count',5,'state','pending','challenge',pg_temp.sha(repeat('C',43)),
    'inspection',pg_temp.sha('nonce-table-inspect-0001'),'decision',pg_temp.sha('nonce-table-decide-00001'),
    'transport',(select transport_revision from live)),
  'only digests, the column count and the revision are stored for the challenge');
select is(pg_temp.session()->>'status','mapping_required','the session waits for the decision');
select is(pg_temp.session()->>'locus','chrom-pos','the canonical locus kind is recorded');
select throws_ok($$update public.embryo_ingest_sessions set table_locus='rsid' where id=(select id from live)$$,
  '55000','immutable table mapping','the locus kind is write-once');
select throws_ok($$update public.embryo_mapping_challenges set decision_nonce_hash=repeat('b',64)
  where ingest_session_id=(select id from live)$$,'55000','immutable mapping challenge',
  'the issued decision nonce is part of the frozen challenge');
select throws_ok($$select pg_temp.inspect()$$,'55000','mapping inspection already recorded',
  'a second inspection cannot issue anything');
select is(pg_temp.locus(),null,'still no locus is readable while a decision is pending');

-- ---------------------------------------------------------------------------
-- Decide the columns
-- ---------------------------------------------------------------------------
create temporary table answer as select '[{"columnIndex":3,"field":"genotype"}]'::jsonb as columns;
select throws_ok($$select pg_temp.decide(repeat('C',43),(select columns from answer),'nonce-table-decide-00009',
    p_build_challenge:=repeat('B',43),p_build_nonce:='nonce-table-decide-00002')$$,
  '42501','mapping challenge unavailable','only the nonce issued with this challenge answers it');
select throws_ok($$select pg_temp.decide(repeat('Z',43),(select columns from answer),'nonce-table-decide-00001',
    p_build_challenge:=repeat('B',43),p_build_nonce:='nonce-table-decide-00002')$$,
  '42501','mapping challenge unavailable','an unknown challenge answers nothing');
select throws_ok($$select pg_temp.decide(repeat('C',43),(select columns from answer),'nonce-table-decide-00001',
    p_transport:=repeat('T',43),p_completion:='nonce-table-complete-01',p_csrf:='nonce-table-csrf-000001')$$,
  '55000','mapping decision unavailable','a column decision cannot skip the pending build question');
select throws_ok($$select pg_temp.decide(repeat('C',43),'[{"columnIndex":5,"field":"genotype"}]','nonce-table-decide-00001',
    p_build_challenge:=repeat('B',43),p_build_nonce:='nonce-table-decide-00002')$$,
  '22023','invalid mapping decision','an index beyond the column count is refused');
select throws_ok($$select pg_temp.decide(repeat('C',43),'[{"columnIndex":2,"field":"rsid"}]','nonce-table-decide-00001',
    p_build_challenge:=repeat('B',43),p_build_nonce:='nonce-table-decide-00002')$$,
  '22023','invalid mapping decision','a field of the other locus kind is refused');
select throws_ok($$select pg_temp.decide(repeat('C',43),'{"referenceBuild":"GRCh38"}','nonce-table-decide-00001',
    p_build_challenge:=repeat('B',43),p_build_nonce:='nonce-table-decide-00002')$$,
  '22023','invalid mapping decision','a build answer to a column challenge is cross-kind');
select throws_ok($$select pg_temp.decide(repeat('C',43),'[{"columnIndex":1,"field":"sample","label":"Embryo A"}]','nonce-table-decide-00001',
    p_build_challenge:=repeat('B',43),p_build_nonce:='nonce-table-decide-00002')$$,
  '22023','invalid mapping decision','a decision cannot carry a label');
select is((select state from public.embryo_mapping_challenges where ingest_session_id=(select id from live)),'pending',
  'every refused decision leaves the challenge pending');
select is((select count(*) from public.embryo_operation_nonces where operation='ingest_mapping_decide'),0::bigint,
  'and consumes no nonce');

-- An expired real challenge is terminal, probed and rolled back.
select is(pg_temp.probe($$alter table public.embryo_mapping_challenges disable trigger embryo_mapping_challenge_immutable;
    update public.embryo_mapping_challenges set expires_at=clock_timestamp()-interval '1 second' where ingest_session_id=(select id from live);
    alter table public.embryo_mapping_challenges enable trigger embryo_mapping_challenge_immutable$$,
  $$select pg_temp.decide(repeat('C',43),(select columns from answer),'nonce-table-decide-00001',
    p_build_challenge:=repeat('B',43),p_build_nonce:='nonce-table-decide-00002')||jsonb_build_object('failure',pg_temp.session()->>'failure')$$),
  jsonb_build_object('status','failure_pending','cohortId',(select cohort_id from live),
    'ingestRevision',(select ingest_revision from live),'failure','mapping'),
  'an expired challenge marks the attempt failure-pending for the one unwind');

create temporary table decided as select pg_temp.decide(repeat('C',43),(select columns from answer),
  'nonce-table-decide-00001',p_build_challenge:=repeat('B',43),p_build_nonce:='nonce-table-decide-00002') as body;
select is((select body->>'status' from decided),'challenge','a column decision with a pending build issues the next challenge');
select is((select body->>'kind' from decided),'build','the next challenge is the build question');
select is((select jsonb_build_object('state',state,'resolution',resolution,'nonce',resolution_nonce_hash)
  from public.embryo_mapping_challenges where challenge_hash=pg_temp.sha(repeat('C',43))),
  jsonb_build_object('state','resolved','resolution','[{"columnIndex":3,"field":"genotype"}]'::jsonb,
    'nonce',pg_temp.sha('nonce-table-decide-00001')),
  'only the column index and the canonical field are kept for the decision');
select is((select jsonb_build_object('kind',challenge_kind,'state',state,'count',column_count,
    'inspection',inspection_nonce_hash,'decision',decision_nonce_hash)
  from public.embryo_mapping_challenges where challenge_hash=pg_temp.sha(repeat('B',43))),
  jsonb_build_object('kind','build','state','pending','count',null,
    'inspection',pg_temp.sha('nonce-table-decide-00001'),'decision',pg_temp.sha('nonce-table-decide-00002')),
  'the build challenge is bound to the decision that issued it and to its own decision nonce');
select is(pg_temp.session()->>'status','mapping_required','the session still waits');
select throws_ok($$select pg_temp.decide(repeat('C',43),(select columns from answer),'nonce-table-decide-00001',
    p_build_challenge:=repeat('D',43),p_build_nonce:='nonce-table-decide-00003')$$,
  '55000','mapping decision already recorded','an exact replay cannot issue a second challenge');

-- ---------------------------------------------------------------------------
-- Decide the build
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.decide(repeat('B',43),'{"referenceBuild":"GRCh38"}','nonce-table-decide-00002',
    p_build_challenge:=repeat('D',43),p_build_nonce:='nonce-table-decide-00003')$$,
  '55000','mapping decision unavailable','a build decision is followed only by the transport');
select throws_ok($$select pg_temp.decide(repeat('B',43),'{"referenceBuild":"hg38"}','nonce-table-decide-00002',
    p_transport:=repeat('T',43),p_completion:='nonce-table-complete-01',p_csrf:='nonce-table-csrf-000001')$$,
  '22023','invalid mapping decision','only GRCh37, GRCh38 or unknown answers the build question');
select is(pg_temp.probe('create temporary table probe_unknown as select pg_temp.decide(repeat(''B'',43),''{"referenceBuild":"unknown"}'',''nonce-table-decide-00002'',p_transport:=repeat(''T'',43),p_completion:=''nonce-table-complete-01'',p_csrf:=''nonce-table-csrf-000001'') as body',
  $$select (select body from probe_unknown)||jsonb_build_object('session',pg_temp.session() - array['locus','mapping','revision'],
    'due',(select count(*) from public.retention_rows r join public.retention_due_phases d on d.retention_row_id=r.id
      where r.target_id=(select id from live) and d.status='pending'))$$),
  jsonb_build_object('status','terminal','branch','build_unknown','cohortId',(select cohort_id from live),
    'ingestRevision',(select ingest_revision from live),
    'session',jsonb_build_object('status','failure_pending','format','pgt_table','build',null,'configured',null,
      'evidence','decision-required','failure','build','transport',null,'completion',null,'csrf',null),'due',1),
  'unknown ends the upload: failure-pending with the build code, no build and no transport, the due target kept');

create temporary table transported as select pg_temp.decide(repeat('B',43),'{"referenceBuild":"GRCh38"}',
  'nonce-table-decide-00002',p_transport:=repeat('T',43),p_completion:='nonce-table-complete-01',
  p_csrf:='nonce-table-csrf-000001') as body;
select is((select body->>'status' from transported),'transport','the last decision issues the transport');
select is((select body->>'build' from transported),'GRCh38','with the answered build');
select ok((select (body->>'revision')::bigint between 2 and 281474976710657 from transported),
  'the transport revision is random, positive, safe and never the minted 1');
select is(pg_temp.session() - array['mapping'],jsonb_build_object('status','open','format','pgt_table','build','GRCh38',
    'configured',null,'evidence','decision-required','locus','chrom-pos','failure',null,
    'transport',pg_temp.sha(repeat('T',43)),'completion',pg_temp.sha('nonce-table-complete-01'),
    'csrf',pg_temp.sha('nonce-table-csrf-000001'),'revision',(select (body->>'revision')::bigint from transported)),
  'the build is resolved, the evidence stays decision-required, and the transport is stored as digests only');
select ok((select position(repeat('T',43) in to_jsonb(s)::text)=0 and position('nonce-table-complete-01' in to_jsonb(s)::text)=0
  from public.embryo_ingest_sessions s where id=(select id from live)),'no raw transport value survives in the session');
select is((select count(*) from public.embryo_mapping_challenges where ingest_session_id=(select id from live) and state='pending'),
  0::bigint,'nothing is left to decide');
select is((select count(*) from public.embryo_operation_nonces where operation in ('ingest_mapping_inspect','ingest_mapping_decide')
  and target_id=(select id from live)),3::bigint,'each mapping nonce is consumed exactly once');
select is(public.embryo_ingest_issued_tokens_match_v1('7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',(select id from live),(select cookie_hash from live),'http://localhost:3000',
  pg_temp.sha('nonce-table-complete-01'),pg_temp.sha('nonce-table-csrf-000001'),true),true,
  'the completion route accepts exactly the tokens the mapping route issued');
select throws_ok($$update public.embryo_ingest_sessions set transport_challenge_hash=repeat('a',64)
  where id=(select id from live)$$,'55000','immutable ingest transport','the table transport is write-once');
select throws_ok($$select pg_temp.decide(repeat('B',43),'{"referenceBuild":"GRCh38"}','nonce-table-decide-00002',
    p_transport:=repeat('U',43),p_completion:='nonce-table-complete-02',p_csrf:='nonce-table-csrf-000002')$$,
  '55000','mapping decision already recorded','a replayed build decision cannot issue a second transport');

-- ---------------------------------------------------------------------------
-- The chunk route's locus read
-- ---------------------------------------------------------------------------
select is(pg_temp.locus(),'chrom-pos','after the transport, the chunk route reads the recorded locus kind');
select is(pg_temp.locus(p_cookie:=repeat('d',64)),null,'a foreign cookie reads nothing');
select throws_ok($$select pg_temp.locus(p_test:=false)$$,'42501','jurisdiction unavailable',
  'the locus read refuses outside TEST-LOCAL');
select is(pg_temp.authorize_status(),'authorized','the attempt stays live for its chunks');

-- ---------------------------------------------------------------------------
-- An explicit build with a header the rule resolves: one step to the transport
-- ---------------------------------------------------------------------------
select is(pg_temp.probe($$set constraints all immediate;
    alter table public.embryo_ingest_sessions disable trigger embryo_configuration_immutable;
    alter table public.embryo_ingest_sessions disable trigger embryo_transport_issue_immutable;
    alter table public.embryo_ingest_sessions disable trigger embryo_table_mapping_immutable;
    delete from public.embryo_mapping_challenges where ingest_session_id=(select id from live);
    update public.embryo_ingest_sessions set status='open',reference_build='GRCh37',configured_build='GRCh37',
      build_evidence='explicit-header',table_locus=null,transport_challenge_hash=null,issued_completion_nonce_hash=null,
      issued_csrf_hash=null,transport_challenge=(select transport_challenge from live),
      transport_revision=(select transport_revision from live),
      issued_mapping_nonce_hash=pg_temp.sha('nonce-table-inspect-0005') where id=(select id from live);
    alter table public.embryo_ingest_sessions enable trigger embryo_table_mapping_immutable;
    alter table public.embryo_ingest_sessions enable trigger embryo_transport_issue_immutable;
    alter table public.embryo_ingest_sessions enable trigger embryo_configuration_immutable$$,
  $$select pg_temp.inspect(p_outcome:='transport',p_count:=null,p_locus:='rsid',p_nonce:='nonce-table-inspect-0005',
    p_challenge:=repeat('V',43),p_next:=null,p_completion:='nonce-table-complete-05',p_csrf:='nonce-table-csrf-000005')
    - 'revision'||jsonb_build_object('locus',pg_temp.locus(),
    'challenges',(select count(*) from public.embryo_mapping_challenges where ingest_session_id=(select id from live)))$$),
  jsonb_build_object('status','transport','build','GRCh37','locus','rsid','challenges',0),
  'a stated build and a resolved header issue the transport at inspection, with no challenge');

select * from finish();
rollback;
