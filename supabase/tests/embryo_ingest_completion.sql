begin;
select no_plan();
\ir fixtures/embryo_cohort_pre_finalize.inc

-- A real signed two-parent cohort of three embryos, its minted attempt, and a
-- VCF configuration with a header-derived build. Synthetic throughout: the
-- fragment digests below are digests of fixed strings, not of any genome.
create temporary table minted as select private.finalize_embryo_cohort_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),(select insurance from acks),(select charter from acks),
  'nonce-completion-finalize','http://localhost:3000',true) as body;
create temporary table live as select s.* from public.embryo_ingest_sessions s
  where s.id=(select (body->'ingest'->>'session')::uuid from minted);
select is(private.configure_embryo_ingest_session_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select id from live),(select cookie_hash from live),'http://localhost:3000',
  (select cohort_id from live),(select ingest_revision from live),
  'vcf','GRCh38','explicit-header','nonce-completion-configure',true)->>'status',
  'configured','the attempt records a VCF format and a header-derived build');

create function pg_temp.fragments(p_sequence integer) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('ordinal',o,
    'sha256',encode(extensions.digest('synthetic-fragment:'||p_sequence||':'||o,'sha256'),'hex'),
    'bytes',80+o,'lines',4) order by o)
  from generate_series(0,2) o;
$$;
create function pg_temp.chunk_sha(p_sequence integer) returns text language sql as $$
  select encode(extensions.digest('synthetic-chunk:'||p_sequence,'sha256'),'hex');
$$;
-- Reserve, land every fragment object at its reserved name and size, commit.
create function pg_temp.store_chunk(p_sequence integer, p_commit boolean default true)
returns text language plpgsql as $$
declare r jsonb;
begin
  r:=private.reserve_embryo_ingest_chunk_v1((select id from live),p_sequence,pg_temp.chunk_sha(p_sequence),
    400,12,120,pg_temp.fragments(p_sequence));
  if r->>'status'<>'reserved' then return r->>'status'; end if;
  insert into storage.objects(bucket_id,name,metadata)
    select f.bucket_id,f.object_name,jsonb_build_object('size',f.byte_count)
    from public.embryo_ingest_fragments f
    where f.session_id=(select id from live) and f.sequence=p_sequence;
  if not p_commit then return 'reserved'; end if;
  return private.commit_embryo_ingest_chunk_v1((select id from live),p_sequence,pg_temp.chunk_sha(p_sequence))->>'status';
end $$;
create function pg_temp.complete(
  p_count integer default 2, p_nonce text default 'nonce-completion-0001',
  p_account uuid default '7a000000-0000-0000-0000-000000000001',
  p_auth uuid default '7a000000-0000-4000-8000-0000000000a1',
  p_cookie text default null, p_cohort uuid default null, p_test boolean default true
) returns jsonb language sql as $$
  select private.complete_embryo_ingest_v1(p_account,p_auth,(select id from live),
    coalesce(p_cookie,(select cookie_hash from live)),'http://localhost:3000',
    coalesce(p_cohort,(select cohort_id from live)),(select ingest_revision from live),
    p_count,p_nonce,p_test)
$$;
-- Run a setup and a call in a subtransaction that is always rolled back, and
-- report what the call returned and what an observation saw afterwards.
create function pg_temp.probe(p_setup text,p_call text,p_observe text default 'select null::text')
returns text language plpgsql as $$
declare v_result text; v_observed text;
begin
  begin
    execute p_setup;
    execute p_call into v_result;
    execute p_observe into v_observed;
    raise exception using errcode='ZY001',message='restore synthetic probe';
  exception when sqlstate 'ZY001' then null;
  end;
  return v_result||coalesce(' / '||v_observed,'');
end $$;
create function pg_temp.probe_error(p_setup text,p_call text) returns text language plpgsql as $$
declare v text;
begin
  begin
    execute p_setup;
    execute p_call;
    v:='no error';
    raise exception using errcode='ZY001',message='restore synthetic probe';
  exception when sqlstate 'ZY001' then null;
    when others then v:=sqlstate||' '||sqlerrm;
  end;
  return v;
end $$;
-- What a terminal branch left behind: code, status, jobs, fragments, handles,
-- chunks and the still-pending due phase.
create function pg_temp.residue() returns text language sql as $$
  select concat_ws(':',coalesce(s.failure_code,''),s.status,
    (select count(*) from public.worker_jobs w where w.source_binding_id=s.id),
    (select count(*) from public.embryo_ingest_fragments f where f.session_id=s.id),
    (select count(*) from public.embryo_fragment_handle_maps m where m.session_id=s.id),
    (select count(*) from public.embryo_ingest_chunks k where k.session_id=s.id),
    (select d.status from public.retention_due_phases d where d.target_id=s.id
      and d.retention_id='embryo.ingest-session-24h'),
    (select count(*) from public.embryo_operation_nonces n where n.operation='ingest_complete'))
  from public.embryo_ingest_sessions s where s.id=(select id from live);
$$;

select is(pg_temp.store_chunk(0),'stored','chunk 0 lands every fragment and commits');
select is(pg_temp.store_chunk(1),'stored','chunk 1 lands every fragment and commits');

-- ---------------------------------------------------------------------------
-- Privileges and shape
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon',
  'public.complete_embryo_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,integer,text,boolean)','execute'),
  'anonymous callers cannot complete an upload');
select ok(not has_function_privilege('authenticated',
  'public.complete_embryo_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,integer,text,boolean)','execute'),
  'a signed-in client cannot complete an upload it names itself');
select ok(not has_function_privilege('authenticated',
  'private.complete_embryo_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,integer,text,boolean)','execute'),
  'the private transaction stays closed to signed-in clients');
select ok(has_function_privilege('service_role',
  'public.complete_embryo_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,integer,text,boolean)','execute'),
  'the server role reaches the completion door');
select ok(not has_function_privilege('service_role','private.embryo_ingest_manifest_sha256_v1(uuid)','execute'),
  'the manifest digest is internal to the database');
select ok(not has_function_privilege('service_role','private.embryo_ingest_completion_failure_v1(uuid,text)','execute'),
  'no service caller can mark a completion failure directly');
select is((select prosecdef from pg_proc where oid=
  'public.complete_embryo_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,integer,text,boolean)'::regprocedure),
  false,'the door carries no privilege of its own');
select ok((select proconfig @> array['lock_timeout=250ms'] from pg_proc where oid=
  'private.complete_embryo_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,integer,text,boolean)'::regprocedure),
  'completion bounds contending lock waits');

-- ---------------------------------------------------------------------------
-- Denials that write nothing
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.complete(p_account:='7a000000-0000-0000-0000-000000000002')$$,
  '42501','ingest unavailable','another account cannot complete this attempt');
select throws_ok($$select pg_temp.complete(p_auth:='7a000000-0000-4000-8000-0000000000b1')$$,
  '42501','ingest unavailable','another live login cannot complete this attempt');
select throws_ok($$select pg_temp.complete(p_cookie:=repeat('f',64))$$,
  '42501','ingest unavailable','a wrong cookie cannot complete this attempt');
select throws_ok($$select pg_temp.complete(p_cohort:='7a000000-0000-0000-0000-000000000099')$$,
  '42501','ingest unavailable','a different expected cohort cannot complete the real attempt');
select throws_ok($$select pg_temp.complete(p_test:=false)$$,
  '42501','jurisdiction unavailable','completion cannot run in a real jurisdiction');
select throws_ok($$select pg_temp.complete(p_nonce:='short')$$,
  '22023','invalid ingest completion','a malformed nonce is a retryable invalid request');
select throws_ok($$select pg_temp.complete(0)$$,
  '22023','invalid ingest completion','a zero chunk count is invalid');
select throws_ok($$select pg_temp.complete(51)$$,
  '22023','invalid ingest completion','a chunk count above the session cap is invalid');
select is((select to_jsonb(s)-'status'-'expected_next_sequence'-'accepted_bytes'-'accepted_chunks'
    -'accepted_records'-'source_format'-'reference_build'-'configured_build'-'build_evidence'
    -'configuration_nonce_hash' from public.embryo_ingest_sessions s where id=(select id from live)),
  (select to_jsonb(s)-'status'-'expected_next_sequence'-'accepted_bytes'-'accepted_chunks'
    -'accepted_records'-'source_format'-'reference_build'-'configured_build'-'build_evidence'
    -'configuration_nonce_hash' from live s),
  'every denial preserves the attempt''s identity, deadline and binding');
select is(pg_temp.residue(),':open:0:6:3:2:pending:0',
  'every denial leaves the attempt open with no job and no spent completion nonce');

-- ---------------------------------------------------------------------------
-- Terminal branches: each marks failure_pending with a closed code, enqueues
-- nothing, and preserves every fragment, handle, chunk and the due target.
-- ---------------------------------------------------------------------------
select is(pg_temp.probe('select 1','select pg_temp.complete(3)->>''status''','select pg_temp.residue()'),
  'failure_pending / chunk:failure_pending:0:6:3:2:pending:0',
  'a chunk count the server does not hold is a terminal chunk failure');
select is(pg_temp.probe('select pg_temp.store_chunk(2,false)',
  'select pg_temp.complete(3)->>''failureCode''','select pg_temp.residue()'),
  'chunk / chunk:failure_pending:0:9:3:3:pending:0',
  'a reserved chunk that never committed cannot be completed');
select is(pg_temp.probe(
  'delete from public.embryo_ingest_fragments where session_id=(select id from live) and sample_ordinal=2',
  'select pg_temp.complete()->>''failureCode''','select pg_temp.residue()'),
  'format / format:failure_pending:0:4:3:2:pending:0',
  'a missing embryo ordinal is terminal, never a smaller cohort');
-- A table chunk may carry a subset of ordinals, so for tables only the whole
-- ordinal set decides; the VCF per-chunk rule below cannot mask this one.
select is(pg_temp.probe(
  $$alter table public.embryo_ingest_sessions disable trigger embryo_configuration_immutable;
    update public.embryo_ingest_sessions set source_format='pgt_table' where id=(select id from live);
    alter table public.embryo_ingest_sessions enable trigger embryo_configuration_immutable;
    delete from public.embryo_ingest_fragments where session_id=(select id from live) and sample_ordinal=2$$,
  'select pg_temp.complete()->>''failureCode'''),
  'format','a table upload missing one embryo is terminal');
select is(pg_temp.probe(
  $$alter table public.embryo_ingest_sessions disable trigger embryo_configuration_immutable;
    update public.embryo_ingest_sessions set source_format='pgt_table' where id=(select id from live);
    alter table public.embryo_ingest_sessions enable trigger embryo_configuration_immutable;
    delete from public.embryo_ingest_fragments where session_id=(select id from live) and sample_ordinal=2 and sequence=1$$,
  'select pg_temp.complete()->>''status'''),
  'sanitization_pending','a table chunk may carry a subset of the embryos');
select is(pg_temp.probe(
  'delete from public.embryo_ingest_fragments where session_id=(select id from live) and sample_ordinal=2 and sequence=1',
  'select pg_temp.complete()->>''failureCode'''),
  'format','a VCF chunk that lost one embryo''s fragment is terminal even when the ordinal set looks whole');
select is(pg_temp.probe(
  $$update storage.objects set name=name||'.moved' where name=(select object_name from public.embryo_ingest_fragments
    where session_id=(select id from live) and sequence=1 and sample_ordinal=0)$$,
  'select pg_temp.complete()->>''failureCode''','select pg_temp.residue()'),
  'chunk / chunk:failure_pending:0:6:3:2:pending:0',
  'a fragment object that has not landed at its reserved name blocks completion');
select is(pg_temp.probe(
  $$update storage.objects set metadata=jsonb_build_object('size',1) where name=(select object_name
    from public.embryo_ingest_fragments where session_id=(select id from live) and sequence=0 and sample_ordinal=1)$$,
  'select pg_temp.complete()->>''failureCode'''),
  'chunk','a landed object of the wrong size blocks completion');
select is(pg_temp.probe(
  $$alter table public.embryo_ingest_sessions disable trigger embryo_configuration_immutable;
    update public.embryo_ingest_sessions set reference_build=null where id=(select id from live);
    alter table public.embryo_ingest_sessions enable trigger embryo_configuration_immutable$$,
  'select pg_temp.complete()->>''failureCode'''),
  'build','an unresolved build at completion is terminal');
select is(pg_temp.probe(
  $$alter table public.embryo_ingest_sessions disable trigger embryo_configuration_immutable;
    update public.embryo_ingest_sessions set configuration_nonce_hash=null,configured_build=null,
      build_evidence=null where id=(select id from live);
    alter table public.embryo_ingest_sessions enable trigger embryo_configuration_immutable$$,
  'select pg_temp.complete()->>''failureCode'''),
  'format','an unconfigured attempt cannot complete');
select is(pg_temp.probe(
  $$update public.embryos set status='qc_pass' where cohort_id=(select cohort_id from live) and sample_ordinal=2$$,
  'select pg_temp.complete()->>''failureCode''','select pg_temp.residue()'),
  'stale-binding / stale-binding:failure_pending:0:6:3:2:pending:0',
  'a broken one-to-one embryo reservation is a stale binding');

-- Stale authority, rechecked through the shared door before any other read.
select is(pg_temp.probe(
  $$delete from auth.sessions where id='7a000000-0000-4000-8000-0000000000a1'$$,
  'select pg_temp.complete()->>''status''','select pg_temp.residue()'),
  'failure_pending / authenticated-session-revocation:failure_pending:0:6:3:2:pending:0',
  'a revoked login marks the attempt failed and enqueues nothing');
select is(pg_temp.probe(
  $$update public.embryo_cohorts set participant_set_revision=participant_set_revision+1
    where id=(select cohort_id from live)$$,
  'select pg_temp.complete()->>''status''','select pg_temp.residue()'),
  'failure_pending / stale-binding:failure_pending:0:6:3:2:pending:0',
  'a changed cohort revision is a stale binding with zero publication');
select is(pg_temp.probe(
  $$update public.profiles set jurisdiction_revision=jurisdiction_revision+1
    where id='7a000000-0000-0000-0000-000000000002'$$,
  'select pg_temp.complete()->>''status'''),
  'failure_pending','a co-parent jurisdiction change invalidates completion authority');

-- A pending decision is not a failure: nothing is written and the nonce is unspent.
select is(pg_temp.probe(
  $$update public.embryo_ingest_sessions set status='mapping_required' where id=(select id from live)$$,
  'select pg_temp.complete()->>''status''','select pg_temp.residue()'),
  'mapping_required / :mapping_required:0:6:3:2:pending:0',
  'a pending mapping or build decision is nonterminal');

-- ---------------------------------------------------------------------------
-- Success
-- ---------------------------------------------------------------------------
create temporary table before_mail as select count(*) as n from public.mail_outbox;
create temporary table completed as select pg_temp.complete() as body;
select is((select body->>'status' from completed),'sanitization_pending','completion enters sanitization_pending');
select is((select body->>'analysisState' from completed),'queued','the sanitization job is queued');
select is((select (body->>'uploadId')::uuid from completed),(select upload_id from live),
  'the receipt names the server-issued upload id');
select is((select array_agg(k order by k) from completed, jsonb_object_keys(body) k),
  array['analysisState','jobId','status','uploadId'],
  'the receipt carries exactly the registered fields');

create temporary table job as select w.* from public.worker_jobs w
  where w.id=(select (body->>'jobId')::uuid from completed);
select is((select count(*) from public.worker_jobs where source_binding_id=(select id from live)),1::bigint,
  'exactly one job is bound to the attempt');
select is((select kind||'/'||output_kind||'/'||source_binding_kind||'/'||target_kind from job),
  'split_cohort_vcf/ingest.normalize/embryo-ingest-fragment-set/cohort',
  'the job is the registered cohort sanitization dispatch');
select ok((select cohort_id=(select cohort_id from live) and subject_id is null and file_id is null
  and source_binding_id=(select id from live) and source_binding_revision=1
  and computation_revision='embryo-split-v1' and status='queued' and attempts=0
  and payload='{}'::jsonb and user_id='7a000000-0000-0000-0000-000000000001' from job),
  'the job targets the cohort, binds the session and carries no payload');
select is((select file_sha256 from job),(select manifest_sha256 from public.embryo_ingest_sessions
  where id=(select id from live)),'the job fingerprint is the locked manifest digest');
select is((select file_sha256 from job),private.embryo_ingest_manifest_sha256_v1((select id from live)),
  'the manifest digest is reproducible from the locked rows');
select is((select idempotency_key from job),private.worker_job_idempotency_key('split_cohort_vcf',
  'ingest.normalize','cohort',(select cohort_id from live),'embryo-ingest-fragment-set',(select id from live),
  1,(select file_sha256 from job),'embryo-split-v1'),'the job carries the registered idempotency key');
select ok((select s.status='sanitization_pending' and s.completed_at is not null and s.manifest_chunk_count=2
  and s.worker_job_id=(select id from job) and s.expires_at=(select expires_at from live)
  and s.failure_code is null from public.embryo_ingest_sessions s where s.id=(select id from live)),
  'the attempt locks its manifest without renewing its fixed deadline');
select is((select status from public.embryo_cohorts where id=(select cohort_id from live)),'ingesting',
  'the cohort reads as ingesting');
select is((select count(*) from public.embryo_operation_nonces where operation='ingest_complete'
  and target_kind='ingest_session' and target_id=(select id from live)),1::bigint,
  'the completion nonce is spent with the transition');

-- Nothing is visible and nothing is published before the terminal transaction.
select ok((select publication_revision is null and uploaded_at is null and qc_failed_at is null
  from public.embryo_cohorts where id=(select cohort_id from live)),'the cohort is unpublished');
select is((select array_agg(distinct status) from public.embryos where cohort_id=(select cohort_id from live)),
  array['pending'],'every embryo is still pending');
select is((select array_agg(distinct lifecycle) from public.subjects where cohort_id=(select cohort_id from live)),
  array['quarantined'],'every embryo subject stays quarantined');
select is((select count(*) from public.embryo_qc q join public.embryos e on e.id=q.embryo_id
  where e.cohort_id=(select cohort_id from live)),0::bigint,'no QC row exists');
select is((select count(*) from public.embryo_variants v join public.embryos e on e.id=v.embryo_id
  where e.cohort_id=(select cohort_id from live)),0::bigint,'no variant row exists');
select is((select count(*) from public.embryo_scores x join public.embryos e on e.id=x.embryo_id
  where e.cohort_id=(select cohort_id from live)),0::bigint,'no score row exists');
select is((select count(*) from public.genome_files where cohort_id=(select cohort_id from live)
  or subject_id in (select id from public.subjects where cohort_id=(select cohort_id from live))),0::bigint,
  'no source file is published');
select is((select count(*) from public.worker_jobs where cohort_id=(select cohort_id from live)
  and kind<>'split_cohort_vcf'),0::bigint,'no downstream analysis job is queued');
select is((select count(*) from public.mail_outbox),(select n from before_mail),
  'completion queues no notice');
select is(pg_temp.residue(),':sanitization_pending:1:6:3:2:pending:1',
  'fragments, handles, chunks and the due phase are retained for the worker');

-- ---------------------------------------------------------------------------
-- Idempotent replay
-- ---------------------------------------------------------------------------
create temporary table replay as select pg_temp.complete() as body;
select is((select body->>'status' from replay),'sanitization_in_progress','an exact replay reports progress');
select is((select body->>'jobId' from replay),(select body->>'jobId' from completed),'the replay names the same job');
select is((select count(*) from public.worker_jobs where source_binding_id=(select id from live)),1::bigint,
  'a replay enqueues nothing');
select is(pg_temp.probe(
  $$update public.worker_jobs set status='running',claim_token_hash=repeat('a',64),
    claim_expires_at=clock_timestamp()+interval '1 minute',claimed_by='synthetic' where id=(select id from job)$$,
  'select pg_temp.complete()->>''analysisState'''),'running','a replay reports a running job');
select throws_ok($$select pg_temp.complete(p_nonce:='nonce-completion-0002')$$,'42501','ingest unavailable',
  'a different nonce cannot adopt the committed completion');
select throws_ok($$select pg_temp.complete(3)$$,'42501','ingest unavailable',
  'a different chunk count cannot adopt the committed completion');
select throws_ok($$select pg_temp.complete(p_cookie:=repeat('e',64))$$,'42501','ingest unavailable',
  'a foreign cookie learns nothing about the committed completion');
select is(pg_temp.probe($$delete from auth.sessions where id='7a000000-0000-4000-8000-0000000000a1'$$,
  'select pg_temp.complete()->>''status''','select pg_temp.residue()'),
  'failure_pending / authenticated-session-revocation:failure_pending:1:6:3:2:pending:1',
  'a replay after revocation marks the attempt failed and keeps everything for the unwind');

-- ---------------------------------------------------------------------------
-- The completed attempt is closed to writes and its manifest is frozen.
-- ---------------------------------------------------------------------------
select is(private.reserve_embryo_ingest_chunk_v1((select id from live),2,pg_temp.chunk_sha(2),400,12,120,
  pg_temp.fragments(2))->>'status','denied','no chunk can be reserved after completion');
select is(private.commit_embryo_ingest_chunk_v1((select id from live),1,pg_temp.chunk_sha(1))->>'status',
  'denied','no chunk can be committed after completion');
select throws_ok($$select public.authorize_embryo_ingest_request_v1('7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',(select id from live),(select cookie_hash from live),
  'http://localhost:3000',true)$$,'42501','ingest unavailable','the upload door no longer authorizes this attempt');
select throws_ok($$update public.embryo_ingest_sessions set manifest_sha256=repeat('0',64) where id=(select id from live)$$,
  '55000','immutable ingest manifest','the locked manifest cannot be replaced');
select throws_ok($$update public.embryo_ingest_sessions set status='open' where id=(select id from live)$$,
  '55000','immutable ingest manifest','a completed attempt cannot reopen for writes');
select throws_ok($$update public.embryo_ingest_sessions set worker_job_id=null where id=(select id from live)$$,
  '55000','immutable ingest manifest','the bound job cannot be detached');
select throws_ok($$select private.enqueue_worker_job_v2('7a000000-0000-0000-0000-000000000001','split_cohort_vcf',
  'ingest.normalize',null,(select cohort_id from live),'embryo-ingest-fragment-set',(select id from live),1,
  repeat('a',64),'embryo-split-v2',null,'{}'::jsonb)$$,'23505',null,
  'a second sanitization job for the same attempt is refused structurally');
select isnt(pg_temp.probe($$update public.embryo_ingest_chunks set record_count=record_count+1
    where session_id=(select id from live) and sequence=0$$,
  'select private.embryo_ingest_manifest_sha256_v1((select id from live))'),
  (select manifest_sha256 from public.embryo_ingest_sessions where id=(select id from live)),
  'any later change to a receipt is visible as a manifest mismatch');

-- ---------------------------------------------------------------------------
-- A completed attempt that fails can still plan its one unwind.
-- ---------------------------------------------------------------------------
select is(pg_temp.probe(
  $$select private.mark_embryo_ingest_failure_v1((select id from live),'retry-exhaustion')$$,
  $$select public.prepare_embryo_ingest_unwind_v1((select cohort_id from live),(select ingest_revision from live))->>'status'$$,
  $$select count(*)::text from public.embryo_ingest_delete_objects o join public.embryo_ingest_unwinds u on u.id=o.unwind_id
    where u.session_id=(select id from live) and o.source_kind='ingest-fragment'$$),
  'storage_pending / 6','the attempt''s own sanitization job does not block unwind planning');
select is(pg_temp.probe_error(
  $$select private.enqueue_worker_job_v2('7a000000-0000-0000-0000-000000000001','score_embryo',
    'embryo.single-locus',null,(select cohort_id from live),'cohort-source-set',gen_random_uuid(),1,
    repeat('b',64),'v1',null,'{}'::jsonb);
    select private.mark_embryo_ingest_failure_v1((select id from live),'retry-exhaustion')$$,
  $$select public.prepare_embryo_ingest_unwind_v1((select cohort_id from live),(select ingest_revision from live))$$),
  '55000 unsupported unwind store','any other job targeting the unpublished cohort still fails closed');

select * from finish();
rollback;
