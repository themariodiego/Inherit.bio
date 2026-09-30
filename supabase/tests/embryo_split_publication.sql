begin;
select no_plan();
\ir fixtures/embryo_ingest_completed.inc

-- Retire every other split job inside this transaction so the claim is ours.
update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
  claim_expires_at=null,claimed_by=null
  where kind='split_cohort_vcf' and id<>(select id from job) and status in ('queued','running');
update private.embryo_split_config set enabled=true;

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
create function pg_temp.token() returns text language sql as $$
  select encode(extensions.digest('synthetic-publication-claim','sha256'),'hex');
$$;
create function pg_temp.stage(p_ordinal integer,p_batch integer,p_rows jsonb) returns jsonb language sql as $$
  select public.stage_embryo_split_variants_v1((select id from job),1,pg_temp.token(),p_ordinal,p_batch,p_rows);
$$;
-- A pass lands its canonical parts first, as the worker does; a failure none.
create function pg_temp.finish(p_ordinal integer,p_result jsonb) returns jsonb language plpgsql as $$
begin
  if p_result->>'outcome'='passed' then perform pg_temp.land_parts(p_ordinal,pg_temp.token()); end if;
  return public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),p_ordinal,p_result);
end $$;
create function pg_temp.publish(p_token text default null) returns jsonb language sql as $$
  select public.publish_embryo_split_v1((select id from job),1,coalesce(p_token,pg_temp.token()));
$$;
create function pg_temp.outcome(p_outcome text,p_verdict text,p_reasons text[],p_called integer,p_rows integer,
  p_reason text default null) returns jsonb language sql as $$
  select jsonb_build_object('outcome',p_outcome,'qc',jsonb_build_object('sites_expected',10,'sites_called',p_called,
    'call_rate',p_called::double precision/10,'autosomal_het_rate',0.4,'mean_depth',12.5,
    'qc_verdict',p_verdict,'qc_reasons',to_jsonb(p_reasons)),'failureReason',p_reason,'variantCount',p_rows);
$$;
-- The five facts that decide whether anything about the cohort is visible.
create function pg_temp.visible() returns text language sql as $$
  select concat_ws(':',
    (select string_agg(e.status,',' order by e.sample_ordinal) from public.embryos e where e.cohort_id=(select cohort_id from live)),
    (select string_agg(distinct x.lifecycle,',') from public.subjects x where x.cohort_id=(select cohort_id from live)),
    (select count(*) from public.embryo_qc q join public.embryos e on e.id=q.embryo_id
      where e.cohort_id=(select cohort_id from live)),
    (select count(*) from public.embryo_variants v join public.embryos e on e.id=v.embryo_id
      where e.cohort_id=(select cohort_id from live)),
    (select c.status||'/'||coalesce(c.publication_revision::text,'unpublished') from public.embryo_cohorts c
      where c.id=(select cohort_id from live)));
$$;

-- Three embryos: embryo 1 passes, embryo 2 fails QC after staging rows,
-- embryo 3 is marginal. Each stages rows that exist in no other embryo.
create temporary table claim as select public.claim_embryo_split_job_v1(pg_temp.token(),'synthetic-worker') as body;
select is((select (body->>'attempt')::integer from claim),1,'the fixture job is claimed');
-- Whole-cohort QC failure and a clean pass, each run to publication inside a
-- probe that rolls back, before the main three-embryo flow below.
create function pg_temp.whole(p_failed boolean,p_rows integer) returns jsonb language sql as $$
  select case when p_failed then jsonb_build_object('outcome','qc_fail_no_source','qc',jsonb_build_object(
      'sites_expected',10,'sites_called',5,'call_rate',0.5,'autosomal_het_rate',null,'mean_depth',null,
      'qc_verdict','fail','qc_reasons',jsonb_build_array('embryo_call_rate')),'failureReason','embryo_call_rate','variantCount',0)
    else jsonb_build_object('outcome','passed','qc',jsonb_build_object('sites_expected',10,'sites_called',10,
      'call_rate',1,'autosomal_het_rate',0.3,'mean_depth',null,'qc_verdict','pass','qc_reasons','[]'::jsonb),
      'failureReason',null,'variantCount',p_rows) end;
$$;
create function pg_temp.probe_run(p_failed boolean) returns text language plpgsql as $$
declare v text; o integer; r jsonb;
begin
  begin
    for o in 0..2 loop
      if not p_failed then
        perform pg_temp.stage(o,0,jsonb_build_array(jsonb_build_array(o+1,100+o,'A','G','A/G')));
      end if;
      perform pg_temp.finish(o,pg_temp.whole(p_failed,1));
    end loop;
    r:=pg_temp.publish();
    v:=concat_ws('|',r::text,
      (select concat_ws(':',status,publication_revision,uploaded_at is not null,qc_failed_at is not null)
        from public.embryo_cohorts where id=(select cohort_id from live)),
      (select string_agg(status,',' order by sample_ordinal) from public.embryos where cohort_id=(select cohort_id from live)),
      (select string_agg(distinct lifecycle,',') from public.subjects where cohort_id=(select cohort_id from live)),
      (select count(*)::text from public.embryo_variants v join public.embryos e on e.id=v.embryo_id
        where e.cohort_id=(select cohort_id from live)),
      (select partial::text from public.worker_jobs where id=(select id from job)));
    raise exception using errcode='ZY001',message='restore synthetic probe';
  exception when sqlstate 'ZY001' then null;
  end;
  return v;
end $$;
select is(pg_temp.probe_run(true),
  '{"status": "published", "qcFailed": 3, "published": 0, "publicationRevision": 1}|active:1:f:t|qc_fail,qc_fail,qc_fail|active|0|true',
  'a cohort where every embryo fails QC still publishes every ordinal, with a QC-failure time and no source');
select is(pg_temp.probe_run(false),
  '{"status": "published", "qcFailed": 0, "published": 3, "publicationRevision": 1}|active:1:t:f|qc_pass,qc_pass,qc_pass|active|3|false',
  'a clean cohort publishes three sources and the job is not partial');
select is((select count(*) from private.embryo_split_ordinals where session_id=(select id from live)),0::bigint,
  'the probes left no outcome behind');
select is(pg_temp.stage(0,0,'[[1,1000,"A","G","A/G"],[1,2000,"C",null,"C/C"],[7,3000,"T","C","C/C"]]')->>'rows','3',
  'embryo 1 stages its own calls');
select is(pg_temp.stage(1,0,'[[2,5000,"G","A","A/A"]]')->>'rows','1','embryo 2 stages a call before failing QC');
select is(pg_temp.stage(2,0,'[[22,9000,"C","T","C/T"],[13,4000,"A","G","G/G"]]')->>'rows','2',
  'embryo 3 stages its own calls');
select is(pg_temp.finish(0,pg_temp.outcome('passed','pass','{}',10,3))->>'outcome','passed','embryo 1 passes');
select is(pg_temp.finish(1,pg_temp.outcome('qc_fail_no_source','fail',array['embryo_call_rate'],7,0,'embryo_call_rate'))->>'outcome',
  'qc_fail_no_source','embryo 2 fails QC with a closed reason');

-- ---------------------------------------------------------------------------
-- Nothing is visible, and nothing publishes, before the whole set is terminal
-- ---------------------------------------------------------------------------
select is(pg_temp.visible(),'pending,pending,pending:quarantined:0:0:ingesting/unpublished',
  'before publication every embryo is pending and quarantined, with no QC or genotype row');
select throws_ok($$select pg_temp.publish()$$,'22023','split incomplete',
  'a cohort with an embryo still unresolved cannot publish a subset');
select is(pg_temp.visible(),'pending,pending,pending:quarantined:0:0:ingesting/unpublished',
  'the refused publication left nothing visible');
select is(pg_temp.finish(2,pg_temp.outcome('passed','marginal',array['embryo_call_rate'],9,2))->>'remaining','0',
  'embryo 3 is marginal, and every embryo now has an outcome');
select is(pg_temp.visible(),'pending,pending,pending:quarantined:0:0:ingesting/unpublished',
  'even with every outcome recorded, nothing is visible until the terminal transaction');

create temporary table staged as
  select v.sample_ordinal,v.chromosome,v.position,v.reference_allele,v.alternate_allele,v.genotype
  from private.embryo_split_variants v where v.session_id=(select id from live);
create temporary table sources as
  select o.sample_ordinal,o.source_sha256 from private.embryo_split_ordinals o where o.session_id=(select id from live);

select ok(not has_function_privilege('authenticated','public.publish_embryo_split_v1(uuid,integer,text)','execute'),
  'signed-in clients cannot publish a cohort');
select ok(has_function_privilege('service_role','public.publish_embryo_split_v1(uuid,integer,text)','execute'),
  'the operator worker reaches the publication door');
select throws_ok($$select pg_temp.publish(repeat('f',64))$$,'42501','split claim unavailable',
  'another token cannot publish');

-- Refusals at the terminal transaction write nothing visible.
select is(pg_temp.probe($$delete from auth.sessions where id='7a000000-0000-4000-8000-0000000000a1'$$,
  'select pg_temp.publish()->>''failureCode''','select pg_temp.visible()'),
  'authenticated-session-revocation / pending,pending,pending:quarantined:0:0:ingesting/unpublished',
  'a revoked login at publication publishes nothing and marks the attempt failed');
select is(pg_temp.probe($$update public.embryo_cohorts set participant_set_revision=participant_set_revision+1
    where id=(select cohort_id from live)$$,
  'select pg_temp.publish()->>''failureCode''',
  $$select (select count(*) from private.embryo_split_variants where session_id=(select id from live))::text
    ||':'||(select d.status from public.retention_due_phases d where d.target_id=(select id from live))$$),
  'stale-binding / 5:pending','a stale binding keeps every pending row and the due phase for the unwind');
select throws_ok($$select pg_temp.probe('insert into private.embryo_split_variants(session_id,sample_ordinal,
    worker_job_id,attempt,batch,chromosome,position,reference_allele,alternate_allele,genotype)
    values((select id from live),1,(select id from job),1,0,3,77,''A'',''G'',''A/G'')',
    'select pg_temp.publish()::text')$$,'55000','split pending state inconsistent',
  'a genotype row for an embryo that failed QC stops publication');
select throws_ok($$select pg_temp.probe('delete from private.embryo_split_variants where session_id=(select id from live)
    and sample_ordinal=2 and position=4000','select pg_temp.publish()::text')$$,'55000',
  'split pending state inconsistent','a pass missing one of its rows stops publication');
select is(pg_temp.probe($$alter table public.embryo_ingest_fragments disable trigger embryo_fragment_object_binding;
    update public.embryo_ingest_fragments set content_sha256=repeat('9',64) where session_id=(select id from live)
      and sequence=0 and sample_ordinal=2;
    alter table public.embryo_ingest_fragments enable trigger embryo_fragment_object_binding$$,
  'select pg_temp.publish()->>''failureCode''','select pg_temp.visible()'),
  'stale-binding / pending,pending,pending:quarantined:0:0:ingesting/unpublished',
  'a changed fragment record fails the manifest recheck and publishes nothing');
select is(pg_temp.probe($$update public.embryos set status='qc_pass' where cohort_id=(select cohort_id from live)
    and sample_ordinal=1$$,'select pg_temp.publish()->>''failureCode'''),'stale-binding',
  'an embryo made visible outside publication is a broken reservation, not published over');

-- ---------------------------------------------------------------------------
-- The terminal transaction
-- ---------------------------------------------------------------------------
create temporary table before_mail as select count(*) n from public.mail_outbox;
create temporary table before_audit as select count(*) n from public.legal_audit_log where event_code='embryo.cohort.published';
create temporary table before_subjects as select id,lifecycle_revision from public.subjects where cohort_id=(select cohort_id from live);
create temporary table published as select pg_temp.publish() as body;
select is((select body from published),
  '{"status":"published","publicationRevision":1,"published":2,"qcFailed":1}'::jsonb,
  'one transaction publishes all three embryos: two sources and one QC failure');
select is(pg_temp.visible(),'qc_pass,qc_fail,qc_marginal:active:3:5:active/1',
  'every embryo becomes visible at once, each published or failed');
select ok((select uploaded_at is not null and qc_failed_at is null from public.embryo_cohorts
  where id=(select cohort_id from live)),'a partial publication records the upload time, not a QC-failure time');
select is((select count(*) from public.subjects x join before_subjects b on b.id=x.id
  where x.lifecycle='active' and x.lifecycle_revision=b.lifecycle_revision+1),3::bigint,
  'every embryo subject leaves quarantine together, with a new lifecycle revision');

-- Ordinal identity: each embryo carries exactly its own staged calls.
select is((select array_agg(format('%s:%s:%s:%s:%s:%s',e.sample_ordinal,v.chromosome,v.position,v.reference_allele,
    coalesce(v.alternate_allele,'-'),v.genotype) order by e.sample_ordinal,v.chromosome,v.position)
  from public.embryo_variants v join public.embryos e on e.id=v.embryo_id where e.cohort_id=(select cohort_id from live)),
  (select array_agg(format('%s:%s:%s:%s:%s:%s',sample_ordinal,chromosome,position,reference_allele,
    coalesce(alternate_allele,'-'),genotype) order by sample_ordinal,chromosome,position)
  from staged where sample_ordinal<>1),
  'each passed embryo holds exactly its own staged calls, and nothing else');
select is((select count(*) from public.embryo_variants v join public.embryos e on e.id=v.embryo_id
  where e.cohort_id=(select cohort_id from live) and e.sample_ordinal=1),0::bigint,
  'the embryo that failed QC holds no genotype, and none is borrowed from a sibling');
select ok((select bool_and(v.source_binding_fingerprint=s.source_sha256 and g.subject_id=e.subject_id
    and g.source_sha256=s.source_sha256)
  from public.embryo_variants v join public.embryos e on e.id=v.embryo_id join sources s on s.sample_ordinal=e.sample_ordinal
  join public.genome_files g on g.id=v.source_file_id
  where e.cohort_id=(select cohort_id from live))
  and not exists (select 1 from public.embryo_variants v join public.embryos e on e.id=v.embryo_id
    where e.cohort_id=(select cohort_id from live) and v.source_file_id is null),
  'every genotype is bound to its own embryo''s fragment digest and its own canonical file');
select ok((select bool_and(v.chromosome between 1 and 22) from public.embryo_variants v join public.embryos e
  on e.id=v.embryo_id where e.cohort_id=(select cohort_id from live)),'only autosomal calls are published');

-- QC rows: measured values only, closed reasons, no imputation.
select is((select array_agg(format('%s:%s:%s:%s:%s',e.sample_ordinal,q.qc_verdict,q.sites_called,
    array_to_string(q.qc_reasons,'+'),q.imputation_performed) order by e.sample_ordinal)
  from public.embryo_qc q join public.embryos e on e.id=q.embryo_id where e.cohort_id=(select cohort_id from live)),
  array['0:pass:10::f','1:fail:7:embryo_call_rate:f','2:marginal:9:embryo_call_rate:f'],
  'each embryo has one QC row with its own measurements and closed reasons');
select ok((select bool_and(q.parent_a_concordance is null and q.parent_b_concordance is null
    and q.allelic_dropout_estimate is null and q.contamination_estimate is null and q.imputation_panel is null
    and q.source_laboratory is null and q.source_assay is null)
  from public.embryo_qc q join public.embryos e on e.id=q.embryo_id where e.cohort_id=(select cohort_id from live)),
  'what the file does not measure stays null; nothing is estimated from a parent or a panel');

-- The empty condition registry scores nothing; no research estimate runs.
select is((select count(*) from public.embryo_scores x join public.embryos e on e.id=x.embryo_id
  where e.cohort_id=(select cohort_id from live)),0::bigint,'no condition is scored');
select is((select count(*) from public.embryo_figures f join public.embryo_scores x on x.id=f.finding_id
  join public.embryos e on e.id=x.embryo_id where e.cohort_id=(select cohort_id from live)),0::bigint,'no figure exists');
select is((select count(*) from public.worker_jobs where cohort_id=(select cohort_id from live) and kind<>'split_cohort_vcf'),
  0::bigint,'no score job, polygenic or otherwise, is queued');

-- Terminal bookkeeping.
select ok((select status='done' and partial and progress=100 and progress_note='complete' and finished_at is not null
  and claim_token_hash is null and claim_expires_at is null from public.worker_jobs where id=(select id from job)),
  'the job is done, and partial because one embryo failed QC');
select is((select status from public.embryo_ingest_sessions where id=(select id from live)),'published',
  'the upload attempt is published');
select ok((select d.status='cancelled' and d.terminal_outcome_code='ingest_published' and d.completed_at is not null
  from public.retention_due_phases d where d.target_id=(select id from live) and d.retention_id='embryo.ingest-session-24h'),
  'the exact ingest due phase is cancelled by the publication');
select is((select count(*) from private.embryo_split_ordinals where session_id=(select id from live))
  +(select count(*) from private.embryo_split_variants where session_id=(select id from live)),0::bigint,
  'no attempt-owned pending row outlives the publication');
select is((select count(*) from public.legal_audit_log where event_code='embryo.cohort.published'),
  (select n+1 from before_audit),'one audit event records the publication');
select ok((select not (coded_context ?| array['sex','karyotype','label','genotype','variant']) and route_id is null
  from public.legal_audit_log where event_code='embryo.cohort.published' order by seq desc limit 1),
  'the audit event carries only coded counts');
select is((select count(*) from public.mail_outbox),(select n from before_mail),
  'no notice is queued (rights notices and card addenda are not part of this change)');
select is((select array_agg(distinct closing_date_state||'/'||date_revision) from public.embryos
  where cohort_id=(select cohort_id from live)),array['provisional_until_terminal_ordinal_resolution/1'],
  'the provisional card date is left exactly as issued, never made authoritative here');
select ok((select count(*)=6 from public.embryo_ingest_fragments where session_id=(select id from live))
  and (select count(*)=3 from public.embryo_fragment_handle_maps where session_id=(select id from live)),
  'fragments and handles wait for the post-publication cleanup');

-- ---------------------------------------------------------------------------
-- After publication: nothing can reopen, fail or unwind the attempt
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.publish()$$,'42501','split claim unavailable','a second publication is refused');
select is(public.claim_embryo_split_job_v1(pg_temp.token(),'synthetic-worker'),null::jsonb,'the job cannot be claimed again');
select is(private.mark_embryo_ingest_failure_v1((select id from live),'stale-binding')->>'status','published',
  'a late failure report cannot fail a published attempt');
select is((select status||':'||coalesce(failure_code,'') from public.embryo_ingest_sessions where id=(select id from live)),
  'published:','the published attempt carries no failure code');
select is(public.prepare_embryo_ingest_unwind_v1((select cohort_id from live),(select ingest_revision from live))->>'status',
  'published','a published cohort is never unwound');
select is(pg_temp.visible(),'qc_pass,qc_fail,qc_marginal:active:3:5:active/1','the published state stands');

select * from finish();
rollback;
