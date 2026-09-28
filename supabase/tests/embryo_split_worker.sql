begin;
select no_plan();
\ir fixtures/embryo_ingest_completed.inc

-- Another developer's queued split job would be claimed first; retire every
-- other one inside this transaction so each claim below is deterministic.
update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
  claim_expires_at=null,claimed_by=null
  where kind='split_cohort_vcf' and id<>(select id from job) and status in ('queued','running');

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
create function pg_temp.token(p text) returns text language sql as $$
  select encode(extensions.digest('synthetic-claim-token:'||p,'sha256'),'hex');
$$;
create function pg_temp.qc(p_expected integer,p_called integer,p_verdict text,p_reasons text[])
returns jsonb language sql as $$
  select jsonb_build_object('sites_expected',p_expected,'sites_called',p_called,
    'call_rate',p_called::double precision/p_expected,'autosomal_het_rate',0.25,'mean_depth',null,
    'qc_verdict',p_verdict,'qc_reasons',to_jsonb(p_reasons));
$$;
create function pg_temp.passed(p_count integer,p_verdict text default 'pass') returns jsonb language sql as $$
  select jsonb_build_object('outcome','passed','qc',pg_temp.qc(8,8,p_verdict,'{}'),
    'failureReason',null,'variantCount',p_count);
$$;
create function pg_temp.failed() returns jsonb language sql as $$
  select jsonb_build_object('outcome','qc_fail_no_source',
    'qc',pg_temp.qc(8,4,'fail',array['embryo_call_rate']),'failureReason','embryo_call_rate','variantCount',0);
$$;
create function pg_temp.rows() returns jsonb language sql as $$
  select '[[1,22133085,"T","C","C/C"],[1,22153726,"C","G","C/G"],[2,1000,"A",null,"A/A"]]'::jsonb;
$$;
-- Every assertion about what is visible reads the same five facts.
create function pg_temp.visible() returns text language sql as $$
  select concat_ws(':',
    (select string_agg(distinct e.status,',') from public.embryos e where e.cohort_id=(select cohort_id from live)),
    (select string_agg(distinct x.lifecycle,',') from public.subjects x where x.cohort_id=(select cohort_id from live)),
    (select count(*) from public.embryo_qc q join public.embryos e on e.id=q.embryo_id
      where e.cohort_id=(select cohort_id from live)),
    (select count(*) from public.embryo_variants v join public.embryos e on e.id=v.embryo_id
      where e.cohort_id=(select cohort_id from live)),
    (select coalesce(c.publication_revision::text,'unpublished') from public.embryo_cohorts c
      where c.id=(select cohort_id from live)));
$$;
create function pg_temp.kept() returns text language sql as $$
  select concat_ws(':',
    (select count(*) from private.embryo_split_ordinals where session_id=(select id from live)),
    (select count(*) from private.embryo_split_variants where session_id=(select id from live)),
    (select count(*) from public.embryo_ingest_fragments where session_id=(select id from live)),
    (select count(*) from public.embryo_fragment_handle_maps where session_id=(select id from live)),
    (select d.status from public.retention_due_phases d where d.target_id=(select id from live)
      and d.retention_id='embryo.ingest-session-24h'));
$$;

-- ---------------------------------------------------------------------------
-- Privileges: worker-only stores, service-only doors
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon','public.claim_embryo_split_job_v1(text,text)','execute'),
  'anonymous callers cannot claim embryo work');
select ok(not has_function_privilege('authenticated','public.claim_embryo_split_job_v1(text,text)','execute'),
  'signed-in clients cannot claim embryo work');
select ok(not has_function_privilege('authenticated',
  'public.stage_embryo_split_variants_v1(uuid,integer,text,integer,integer,jsonb)','execute'),
  'signed-in clients cannot stage genotype rows');
select ok(has_function_privilege('service_role','public.claim_embryo_split_job_v1(text,text)','execute'),
  'the operator worker reaches the claim door');
select ok(not has_function_privilege('authenticated',
  'public.read_embryo_split_fragment_v1(uuid,integer,text,integer,integer)','execute'),
  'signed-in clients cannot obtain fragment read authority');
select ok(has_function_privilege('service_role',
  'public.read_embryo_split_fragment_v1(uuid,integer,text,integer,integer)','execute'),
  'the operator worker reaches the fragment read door');
select ok(not has_function_privilege('service_role','private.fail_embryo_split_v1(uuid,uuid,text,text)','execute'),
  'no service caller can mark an attempt failed directly');
select ok(not has_function_privilege('service_role','private.lock_embryo_split_claim_v1(uuid,integer,text)','execute'),
  'the claim lock is internal');
select ok(not has_table_privilege('service_role','private.embryo_split_variants','select'),
  'pending genotype rows are unreadable even to the service role');
select ok(not has_table_privilege('service_role','private.embryo_split_ordinals','select'),
  'pending outcomes are unreadable even to the service role');
select ok(not has_table_privilege('authenticated','private.embryo_split_config','update'),
  'no client can enable the worker');
select is((select target_id from public.purge_target_stores where store_name='private.embryo_split_ordinals'),
  'embryo-qc','pending QC outcomes are registered with embryo QC');
select ok((select bool_and(exists(select 1 from public.purge_manifest_class_targets c
    where c.manifest_class='cohort-prepublication-complete' and c.target_id=t.target_id))
  from public.purge_target_stores t where t.store_name like 'private.embryo_split_%'),
  'the pre-publication purge class covers both pending stores');
select is((select target_id from public.purge_target_stores where store_name='private.embryo_split_variants'),
  'variant-rows','pending genotype rows are registered with the variant stores');

-- ---------------------------------------------------------------------------
-- Disabled by default
-- ---------------------------------------------------------------------------
select is((select enabled from private.embryo_split_config),false,'the worker is off by default');
select throws_ok($$select public.claim_embryo_split_job_v1(pg_temp.token('a'),'synthetic-worker')$$,
  '55000','embryo split disabled','a disabled worker claims nothing');
update private.embryo_split_config set enabled=true;
select throws_ok($$select public.claim_embryo_split_job_v1('not-a-hash','synthetic-worker')$$,
  '22023','invalid split claim','a malformed claim token is refused');
select throws_ok($$select public.claim_embryo_split_job_v1(pg_temp.token('a'),'Synthetic Worker!')$$,
  '22023','invalid split claim','a free-text worker label is refused');

-- ---------------------------------------------------------------------------
-- Claim-time rechecks: stale work is ended, never run
-- ---------------------------------------------------------------------------
select is(pg_temp.probe($$delete from auth.sessions where id='7a000000-0000-4000-8000-0000000000a1'$$,
  $$select coalesce(public.claim_embryo_split_job_v1(pg_temp.token('a'),'synthetic-worker')::text,'none')$$,
  $$select (select failure_code||':'||status from public.embryo_ingest_sessions where id=(select id from live))
    ||':'||(select status from public.worker_jobs where id=(select id from job))$$),
  'none / authenticated-session-revocation:failure_pending:cancelled',
  'a revoked login at claim marks the attempt failed and cancels the job');
select is(pg_temp.probe($$update public.embryo_ingest_chunks set record_count=record_count+1
    where session_id=(select id from live) and sequence=0$$,
  $$select coalesce(public.claim_embryo_split_job_v1(pg_temp.token('a'),'synthetic-worker')::text,'none')$$,
  $$select failure_code from public.embryo_ingest_sessions where id=(select id from live)$$),
  'none / stale-binding','a manifest that no longer reproduces is a stale binding at claim');
select is(pg_temp.probe($$select private.mark_embryo_ingest_failure_v1((select id from live),'cancel')$$,
  $$select coalesce(public.claim_embryo_split_job_v1(pg_temp.token('a'),'synthetic-worker')::text,'none')$$,
  $$select status from public.worker_jobs where id=(select id from job)$$),
  'none / cancelled','a job whose attempt already failed is cancelled, not run');
select is(pg_temp.probe($$alter table public.embryo_ingest_sessions disable trigger embryo_configuration_immutable;
    update public.embryo_ingest_sessions set source_format='pgt_table' where id=(select id from live);
    alter table public.embryo_ingest_sessions enable trigger embryo_configuration_immutable$$,
  $$select coalesce(public.claim_embryo_split_job_v1(pg_temp.token('a'),'synthetic-worker')::text,'none')$$,
  $$select failure_code||':'||(select status from public.worker_jobs where id=(select id from job))
    from public.embryo_ingest_sessions where id=(select id from live)$$),
  'none / stale-binding:cancelled','a changed format no longer matches the locked manifest');
select is(pg_temp.probe($$update public.embryo_cohorts set participant_set_revision=participant_set_revision+1
    where id=(select cohort_id from live)$$,
  $$select coalesce(public.claim_embryo_split_job_v1(pg_temp.token('a'),'synthetic-worker')::text,'none')$$,
  'select pg_temp.kept()'),
  'none / 0:0:6:3:pending','a stale cohort revision ends the job and keeps everything for the unwind');
-- A job of another kind bound to the very same session is neither run nor touched.
select is(pg_temp.probe($$select private.enqueue_worker_job_v2('7a000000-0000-0000-0000-000000000001','score_embryo',
    'embryo.single-locus',null,(select cohort_id from live),'cohort-source-set',(select id from live),1,
    repeat('b',64),'v1',null,'{}'::jsonb);
    update public.worker_jobs set not_before=clock_timestamp()+interval '1 hour' where id=(select id from job)$$,
  $$select coalesce(public.claim_embryo_split_job_v1(pg_temp.token('a'),'synthetic-worker')::text,'none')$$,
  $$select string_agg(status,',') from public.worker_jobs where kind='score_embryo' and source_binding_id=(select id from live)$$),
  'none / queued','no other job kind is ever claimed, cancelled or changed by the embryo worker');
-- A legitimately completed table attempt has no fragment reader yet.
select is(pg_temp.probe($$alter table public.embryo_ingest_sessions disable trigger embryo_configuration_immutable;
    alter table public.embryo_ingest_sessions disable trigger embryo_ingest_manifest_immutable;
    alter table public.worker_jobs disable trigger worker_jobs_binding_immutable;
    update public.embryo_ingest_sessions set source_format='pgt_table' where id=(select id from live);
    update public.embryo_ingest_sessions set manifest_sha256=private.embryo_ingest_manifest_sha256_v1(id) where id=(select id from live);
    update public.worker_jobs set file_sha256=(select manifest_sha256 from public.embryo_ingest_sessions
      where id=(select id from live)) where id=(select id from job);
    alter table public.worker_jobs enable trigger worker_jobs_binding_immutable;
    alter table public.embryo_ingest_sessions enable trigger embryo_ingest_manifest_immutable;
    alter table public.embryo_ingest_sessions enable trigger embryo_configuration_immutable$$,
  $$select coalesce(public.claim_embryo_split_job_v1(pg_temp.token('a'),'synthetic-worker')::text,'none')$$,
  $$select failure_code||':'||(select status from public.worker_jobs where id=(select id from job))
    from public.embryo_ingest_sessions where id=(select id from live)$$),
  'none / format:failed','a laboratory-table attempt ends with the closed format code');

-- ---------------------------------------------------------------------------
-- A live claim
-- ---------------------------------------------------------------------------
create temporary table claim1 as select public.claim_embryo_split_job_v1(pg_temp.token('a'),'synthetic-worker') as body;
select is((select body->>'version' from claim1),'embryo-split-claim-v1','the claim returns its versioned receipt');
select is((select (body->>'jobId')::uuid from claim1),(select id from job),'the claim is the attempt''s own job');
select is((select (body->>'attempt')::integer from claim1),1,'the first claim is attempt one');
select ok((select (body->>'sessionId')::uuid=(select id from live) and (body->>'cohortId')::uuid=(select cohort_id from live)
  and body->>'format'='vcf' and body->>'build'='GRCh38' and (body->>'embryoCount')::integer=3
  and body->>'manifestSha256'=(select file_sha256 from job) from claim1),
  'the receipt binds the session, cohort, build, embryo count and manifest');
select is((select jsonb_array_length(body->'fragments') from claim1),6,'every fragment is named, and nothing else');
select is((select array_agg(distinct k order by k) from claim1, jsonb_array_elements(body->'fragments') f,
    jsonb_object_keys(f) k),array['byteCount','lineCount','ordinal','sequence','sha256'],
  'a fragment is named by session, sequence and ordinal, never by an object path');
select ok((select position((select object_name from public.embryo_ingest_fragments
    where session_id=(select id from live) limit 1) in body::text)=0 from claim1),
  'no object name reaches the worker');
select is((select array_agg((f->>'ordinal')||'.'||(f->>'sequence') order by n) from claim1,
    jsonb_array_elements(body->'fragments') with ordinality x(f,n)),
  array['0.0','0.1','1.0','1.1','2.0','2.1'],'fragments arrive in ordinal then chunk order');
select ok((select (body->>'claimExpiresAt')::timestamptz<=(body->>'deadline')::timestamptz
  and (body->>'deadline')::timestamptz=(select expires_at from live) from claim1),
  'the lease never outlives the attempt''s fixed deadline');
select ok((select status='running' and attempts=1 and claim_token_hash=pg_temp.token('a')
  and claimed_by='synthetic-worker' and progress_note='splitting' from public.worker_jobs where id=(select id from job)),
  'the job is running under the worker''s token');
select is((select status from public.embryo_ingest_sessions where id=(select id from live)),'processing',
  'the attempt is processing');
select is(public.claim_embryo_split_job_v1(pg_temp.token('b'),'synthetic-worker'),null::jsonb,
  'a running job cannot be claimed twice');

create function pg_temp.check(p text default 'a',p_attempt integer default 1) returns jsonb language sql as $$
  select public.check_embryo_split_claim_v1((select id from job),p_attempt,pg_temp.token(p));
$$;
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.check()) k),
  array['attempt','claimExpiresAt','deadline','jobId','manifestSha256','sessionId','version'],
  'a recheck answers the lease only, never the fragment list');
create function pg_temp.read(p_ordinal integer,p_sequence integer,p text default 'a',p_attempt integer default 1)
returns jsonb language sql as $$
  select public.read_embryo_split_fragment_v1((select id from job),p_attempt,pg_temp.token(p),p_ordinal,p_sequence);
$$;
create temporary table read1 as select pg_temp.read(1,0) as body;
select is((select array_agg(k order by k) from read1, jsonb_object_keys(body) k),
  array['byteCount','landed','ordinal','sequence','sessionId','sha256','version'],
  'fragment read authority names the fragment and its landed identity, nothing else');
select ok((select body->>'version'='embryo-split-fragment-v1' and (body->>'ordinal')::integer=1
  and (body->>'sequence')::integer=0 and body->>'sha256'=f.content_sha256
  and (body->>'byteCount')::integer=f.byte_count and body->'landed'='{"backend":"supabase"}'::jsonb
  from read1, public.embryo_ingest_fragments f
  where f.session_id=(select id from live) and f.sequence=0 and f.sample_ordinal=1),
  'the authority is exactly the manifest''s fragment, landed on the test backend');
select ok((select position(f.object_name in r.body::text)=0 from read1 r, public.embryo_ingest_fragments f
  where f.session_id=(select id from live) and f.sequence=0 and f.sample_ordinal=1),
  'read authority carries no object path for the test backend');
-- An R2 landing: the identity is exactly what readEmbryoFragment takes.
select is(pg_temp.probe($$alter table private.embryo_ingest_write_intents disable trigger embryo_ingest_write_intent_identity;
    update private.embryo_ingest_write_intents set backend='r2',provider_bucket='inherit-embryo-synthetic',
      provider_key='embryo/'||gen_random_uuid()::text,storage_object_id=null,storage_version=null,
      provider_version=repeat('1',32),provider_etag=repeat('2',32),observed_sha256=sha256
      where session_id=(select id from live) and sequence=1 and sample_ordinal=2;
    alter table private.embryo_ingest_write_intents enable trigger embryo_ingest_write_intent_identity$$,
  $$select concat_ws('|',(select string_agg(k,',' order by k) from jsonb_object_keys(b->'landed') k),
      (select string_agg(k,',' order by k) from jsonb_object_keys(b->'landed'->'stored') k),
      (select string_agg(k,',' order by k) from jsonb_object_keys(b->'landed'->'stored'->'receipt') k),
      b->'landed'->'stored'->'receipt'->>'backend',b->'landed'->'stored'->>'providerVersion')
    from (select pg_temp.read(2,1) b) x$$),
  'backend,stored|etag,providerVersion,receipt|backend,bucket,byteCount,objectKey,ordinal,sequence,sessionId,sha256,version,writeExpiresAt|r2|11111111111111111111111111111111',
  'an R2 landing hands the worker the exact stored identity its reader requires');
select throws_ok($$select pg_temp.read(1,0,'b')$$,'42501','split claim unavailable',
  'another token obtains no read authority');
select throws_ok($$select pg_temp.read(1,7)$$,'22023','invalid split fragment',
  'a fragment outside the manifest has no read authority');
select is(pg_temp.probe($$alter table private.embryo_ingest_write_intents disable trigger embryo_ingest_write_intent_identity;
    update private.embryo_ingest_write_intents set state='open',storage_object_id=null,storage_version=null,landed_at=null
      where session_id=(select id from live) and sequence=0 and sample_ordinal=1;
    alter table private.embryo_ingest_write_intents enable trigger embryo_ingest_write_intent_identity$$,
  $$select pg_temp.read(1,0)->>'failureCode'$$,
  $$select (select status from public.worker_jobs where id=(select id from job))||':'||pg_temp.kept()$$),
  'chunk / failed:0:0:6:3:pending','a fragment whose landing record is gone ends the attempt before any read');
select is(pg_temp.probe($$delete from auth.sessions where id='7a000000-0000-4000-8000-0000000000a1'$$,
  $$select pg_temp.read(0,1)->>'failureCode'$$),
  'authenticated-session-revocation','read authority reruns the binding check');
select throws_ok($$select pg_temp.check('b')$$,'42501','split claim unavailable','another token holds nothing');
select throws_ok($$select pg_temp.check('a',2)$$,'42501','split claim unavailable','another attempt number holds nothing');
select is(pg_temp.check()->>'jobId',(select id::text from job),'the live claim rechecks cleanly');
select ok(public.renew_embryo_split_claim_v1((select id from job),1,pg_temp.token('a'))->>'claimExpiresAt'
  >=(select body->>'claimExpiresAt' from claim1),'a renewal extends the lease');
select ok((select claim_expires_at<=(select expires_at from live) from public.worker_jobs where id=(select id from job)),
  'a renewal never passes the fixed deadline');

-- Rechecks on a live claim.
select is(pg_temp.probe($$delete from auth.sessions where id='7a000000-0000-4000-8000-0000000000a1'$$,
  $$select pg_temp.check()->>'failureCode'$$,
  $$select (select status from public.worker_jobs where id=(select id from job))||':'||pg_temp.kept()$$),
  'authenticated-session-revocation / cancelled:0:0:6:3:pending',
  'revocation during the attempt is caught before the next fragment read');
select is(pg_temp.probe($$alter table public.embryo_ingest_fragments disable trigger embryo_fragment_object_binding;
    update public.embryo_ingest_fragments set line_count=line_count+1 where session_id=(select id from live) and sequence=1 and sample_ordinal=2;
    alter table public.embryo_ingest_fragments enable trigger embryo_fragment_object_binding$$,
  $$select pg_temp.check()->>'failureCode'$$),
  'stale-binding','a changed fragment record is caught before the next read');
select throws_ok($$select pg_temp.probe('update public.worker_jobs set claim_expires_at=clock_timestamp()-interval ''1 second'' where id=(select id from job)',
  'select pg_temp.check()::text')$$,'42501','split claim unavailable','a lapsed lease holds nothing');

-- ---------------------------------------------------------------------------
-- Staging and per-embryo outcomes
-- ---------------------------------------------------------------------------
create function pg_temp.stage(p_ordinal integer,p_batch integer,p_rows jsonb,p text default 'a',p_attempt integer default 1)
returns jsonb language sql as $$
  select public.stage_embryo_split_variants_v1((select id from job),p_attempt,pg_temp.token(p),p_ordinal,p_batch,p_rows);
$$;
-- A pass lands its canonical parts first, as the worker does; a failure none.
create function pg_temp.finish(p_ordinal integer,p_result jsonb,p text default 'a',p_attempt integer default 1)
returns jsonb language plpgsql as $$
begin
  if p_result->>'outcome'='passed' then perform pg_temp.land_parts(p_ordinal,pg_temp.token(p),p_attempt); end if;
  return public.finish_embryo_split_ordinal_v1((select id from job),p_attempt,pg_temp.token(p),p_ordinal,p_result);
end $$;
select throws_ok($$select pg_temp.stage(0,0,'[[1,5,"A","G","A/."]]')$$,'22023','invalid split batch',
  'a partial call is never stored');
select throws_ok($$select pg_temp.stage(0,0,'[[1,5,"A","G","./."]]')$$,'22023','invalid split batch',
  'a no-call is never stored');
select throws_ok($$select pg_temp.stage(0,0,'[[1,5,"A","G","A/T"]]')$$,'22023','invalid split batch',
  'an allele the locus does not carry is never stored');
select throws_ok($$select pg_temp.stage(0,0,'[[1,5,"A",null,"A/G"]]')$$,'22023','invalid split batch',
  'a reference call cannot carry an alternate genotype');
select throws_ok($$select pg_temp.stage(0,0,'[[23,5,"A","G","A/G"]]')$$,'22023','invalid split batch',
  'a sex chromosome is never stored');
select throws_ok($$select pg_temp.stage(0,0,'[[1,5,"A","G","A/G","extra"]]')$$,'22023','invalid split batch',
  'a row carries exactly five fields');
select throws_ok($$select pg_temp.stage(0,1,pg_temp.rows())$$,'22023','invalid split batch','batches arrive in order');
select throws_ok($$select pg_temp.stage(3,0,pg_temp.rows())$$,'22023','invalid split batch',
  'an ordinal outside the cohort is refused');
select throws_ok($$select pg_temp.stage(0,0,pg_temp.rows(),'b')$$,'42501','split claim unavailable',
  'another token cannot stage');
select is(pg_temp.stage(0,0,pg_temp.rows())->>'rows','3','a valid batch stages');
select is(pg_temp.stage(0,1,'[[3,77,"G","A","A/G"]]')->>'rows','1','the next batch stages');

select throws_ok($$select pg_temp.finish(0,pg_temp.passed(3))$$,'22023','invalid split outcome',
  'a pass must account for every staged row');
select throws_ok($$select pg_temp.finish(0,pg_temp.passed(4)||'{"extra":1}')$$,'22023','invalid split outcome',
  'the outcome object is closed');
select throws_ok($$select pg_temp.finish(0,jsonb_set(pg_temp.passed(4),'{qc,qc_verdict}','"fail"'))$$,'22023',
  'invalid split outcome','a failing verdict cannot publish a source');
select throws_ok($$select pg_temp.finish(0,jsonb_set(pg_temp.passed(4),'{qc,call_rate}','0.5'))$$,'22023',
  'invalid split outcome','a call rate must equal the counts it came from');
select throws_ok($$select pg_temp.finish(0,jsonb_set(pg_temp.passed(4),'{qc,qc_reasons}','["low_quality"]'))$$,'22023',
  'invalid split outcome','only registered QC reasons are recorded');
select throws_ok($$select pg_temp.finish(0,jsonb_set(pg_temp.passed(4),'{qc,imputation_performed}','true'))$$,'22023',
  'invalid split outcome','no imputation field can be smuggled into an outcome');
create temporary table first_done as select pg_temp.finish(0,pg_temp.passed(4)) as body;
select is((select body->>'remaining' from first_done),'2','embryo 1 is recorded as passed, two remain');
select is((select source_sha256 from private.embryo_split_ordinals where session_id=(select id from live) and sample_ordinal=0),
  private.embryo_split_source_sha256_v1((select id from live),0),'the pass binds embryo 1 to its own fragment digests');
select throws_ok($$select pg_temp.finish(0,pg_temp.passed(4))$$,'22023','invalid split outcome',
  'an embryo is recorded once per attempt');
select throws_ok($$select pg_temp.stage(0,2,pg_temp.rows())$$,'22023','invalid split batch',
  'a recorded embryo takes no more rows');

select is(pg_temp.stage(1,0,pg_temp.rows())->>'rows','3','a failing embryo may have staged rows');
select throws_ok($$select pg_temp.finish(1,jsonb_set(pg_temp.failed(),'{failureReason}','null'))$$,'22023',
  'invalid split outcome','a QC failure needs its closed reason');
select throws_ok($$select pg_temp.finish(1,jsonb_set(pg_temp.failed(),'{failureReason}','"contamination"'))$$,'22023',
  'invalid split outcome','the closed reason must be one the measurements triggered');
select is(pg_temp.finish(1,pg_temp.failed())->>'outcome','qc_fail_no_source','embryo 2 fails QC and continues');
select is((select count(*) from private.embryo_split_variants where session_id=(select id from live) and sample_ordinal=1),
  0::bigint,'a QC failure deletes only that embryo''s staged rows');
select is((select count(*) from private.embryo_split_variants where session_id=(select id from live) and sample_ordinal=0),
  4::bigint,'another embryo''s pending pass is untouched');
select ok((select outcome='qc_fail_no_source' and failure_reason='embryo_call_rate' and variant_count=0
  and source_sha256 is null from private.embryo_split_ordinals where session_id=(select id from live) and sample_ordinal=1),
  'the failure keeps one closed reason and no source');

-- Nothing is visible before the terminal publication.
select is(pg_temp.visible(),'pending:quarantined:0:0:unpublished',
  'with recorded outcomes nothing about any embryo is visible yet');
select is((select d.status from public.retention_due_phases d where d.target_id=(select id from live)
  and d.retention_id='embryo.ingest-session-24h'),'pending','the due phase stays live');

-- ---------------------------------------------------------------------------
-- Failure reports
-- ---------------------------------------------------------------------------
create function pg_temp.fail(p_reason text,p text default 'a',p_attempt integer default 1) returns jsonb language sql as $$
  select public.fail_embryo_split_attempt_v1((select id from job),p_attempt,pg_temp.token(p),p_reason);
$$;
select throws_ok($$select pg_temp.fail('network timeout')$$,'22023','invalid split failure','failure reasons are closed');
select throws_ok($$select pg_temp.fail('transient','b')$$,'42501','split claim unavailable','another token cannot fail the job');
select is(pg_temp.probe('select 1',$$select pg_temp.fail('chunk')->>'failureCode'$$,
  $$select (select status from public.worker_jobs where id=(select id from job))||':'||pg_temp.kept()$$),
  'chunk / failed:2:4:6:3:pending','a fragment digest mismatch is terminal and keeps every pending row for the unwind');
select is(pg_temp.probe('select 1',$$select pg_temp.fail('format')->>'failureCode'$$),'format',
  'a fragment that no longer validates is terminal');
select is(pg_temp.probe('update public.worker_jobs set max_attempts=1 where id=(select id from job)',
  $$select pg_temp.fail('transient')->>'failureCode'$$,
  $$select status from public.worker_jobs where id=(select id from job)$$),
  'retry-exhaustion / failed','a transient failure on the last attempt is retry exhaustion');
select is(pg_temp.probe(
  $$update public.worker_jobs set max_attempts=1,claim_expires_at=clock_timestamp()-interval '1 hour'
    where id=(select id from job)$$,
  $$select coalesce(public.claim_embryo_split_job_v1(pg_temp.token('c'),'synthetic-worker')::text,'none')$$,
  $$select failure_code from public.embryo_ingest_sessions where id=(select id from live)$$),
  'none / retry-exhaustion','a lapsed last attempt is retry exhaustion at the next claim');

-- A transient failure requeues with backoff; the next attempt starts empty.
select is(pg_temp.fail('transient')->>'status','queued','a transient failure requeues the job');
select ok((select status='queued' and claim_token_hash is null and not_before>clock_timestamp()+interval '50 seconds'
  and attempts=1 and progress_note='retrying' from public.worker_jobs where id=(select id from job)),
  'the requeue waits thirty seconds times two to the attempts');
select is(public.claim_embryo_split_job_v1(pg_temp.token('d'),'synthetic-worker'),null::jsonb,
  'nothing is claimable during the backoff');
select is(pg_temp.kept(),'2:4:6:3:pending','the requeued attempt''s rows wait for the next claim');
update public.worker_jobs set not_before=clock_timestamp() where id=(select id from job);
create temporary table claim2 as select public.claim_embryo_split_job_v1(pg_temp.token('d'),'synthetic-worker') as body;
select is((select (body->>'attempt')::integer from claim2),2,'the retry is attempt two');
select is(pg_temp.kept(),'0:0:6:3:pending','a new attempt discards the earlier attempt''s pending rows');
select throws_ok($$select pg_temp.stage(0,0,pg_temp.rows(),'a',1)$$,'42501','split claim unavailable',
  'the superseded attempt can no longer write');
select throws_ok($$select pg_temp.fail('chunk','a',1)$$,'42501','split claim unavailable',
  'the superseded attempt can no longer fail the job');
select is(pg_temp.stage(2,0,pg_temp.rows(),'d',2)->>'rows','3','the live attempt writes');

-- Another writer failing the attempt ends the job at the worker's next call.
select is(pg_temp.probe($$select private.mark_embryo_ingest_failure_v1((select id from live),'cancel')$$,
  $$select pg_temp.check('d',2)->>'failureCode'$$,
  $$select (select status from public.worker_jobs where id=(select id from job))||':'||pg_temp.kept()$$),
  'cancel / cancelled:0:3:6:3:pending','an attempt failed elsewhere ends the job and keeps its rows');

-- ---------------------------------------------------------------------------
-- A failed processing attempt can still plan its one unwind.
-- ---------------------------------------------------------------------------
select is(pg_temp.probe($$select pg_temp.fail('format','d',2)$$,
  $$select public.prepare_embryo_ingest_unwind_v1((select cohort_id from live),(select ingest_revision from live))->>'status'$$,
  'select pg_temp.kept()'),
  'storage_pending / 0:3:6:3:pending','unwind planning proceeds and every attempt-owned row survives for it');

select * from finish();
rollback;
