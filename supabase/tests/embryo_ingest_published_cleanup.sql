begin;
select no_plan();
-- Removing a published upload's fragment objects and rows
-- (20260930130000). The synthetic three-embryo upload publishes one pass,
-- one QC failure and one marginal embryo; its six fragment objects then go
-- through the exact disposal doors. Genotypes and digests are synthetic.
\ir fixtures/embryo_ingest_completed.inc

update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
  claim_expires_at=null,claimed_by=null
  where kind='split_cohort_vcf' and id<>(select id from job) and status in ('queued','running');
update private.embryo_split_config set enabled=true;

create function pg_temp.token() returns text language sql as $$
  select encode(extensions.digest('synthetic-cleanup-claim','sha256'),'hex');
$$;
create function pg_temp.outcome(p_outcome text,p_verdict text,p_reasons text[],p_called integer,p_rows integer,
  p_reason text default null) returns jsonb language sql as $$
  select jsonb_build_object('outcome',p_outcome,'qc',jsonb_build_object('sites_expected',10,'sites_called',p_called,
    'call_rate',p_called::double precision/10,'autosomal_het_rate',0.4,'mean_depth',12.5,
    'qc_verdict',p_verdict,'qc_reasons',to_jsonb(p_reasons)),'failureReason',p_reason,'variantCount',p_rows);
$$;
create temporary table cleanup_plan(id uuid);
create function pg_temp.unwind() returns uuid language sql as $$
  select id from cleanup_plan;
$$;
-- Everything published about the cohort, as one digest.
create function pg_temp.published() returns text language sql as $$
  select md5(concat_ws('|',
    (select string_agg(to_jsonb(e)::text,',' order by e.sample_ordinal) from public.embryos e
      where e.cohort_id=(select cohort_id from live)),
    (select string_agg(to_jsonb(x)::text,',' order by x.id) from public.subjects x
      where x.cohort_id=(select cohort_id from live)),
    (select string_agg(to_jsonb(q)::text,',' order by q.embryo_id) from public.embryo_qc q
      join public.embryos e on e.id=q.embryo_id where e.cohort_id=(select cohort_id from live)),
    (select string_agg(to_jsonb(v)::text,',' order by v.embryo_id,v.chromosome,v.position) from public.embryo_variants v
      join public.embryos e on e.id=v.embryo_id where e.cohort_id=(select cohort_id from live)),
    (select string_agg(to_jsonb(s)::text,',' order by s.file_id) from private.embryo_canonical_sources s
      where s.cohort_id=(select cohort_id from live)),
    (select string_agg(to_jsonb(m)::text,',' order by m.file_id,m.sequence) from private.embryo_canonical_source_parts m
      join private.embryo_canonical_sources s on s.file_id=m.file_id where s.cohort_id=(select cohort_id from live)),
    (select string_agg(to_jsonb(p)::text,',' order by p.sample_ordinal,p.sequence) from private.embryo_canonical_parts p
      where p.session_id=(select id from live)),
    (select string_agg(to_jsonb(g)::text,',' order by g.id) from public.genome_files g
      join private.embryo_canonical_sources s on s.file_id=g.id where s.cohort_id=(select cohort_id from live)),
    (select string_agg(to_jsonb(v)::text,',' order by v.file_id,v.chrom,v.pos,v.id) from public.user_variants v
      join private.embryo_canonical_sources s on s.file_id=v.file_id where s.cohort_id=(select cohort_id from live)),
    (select to_jsonb(c)::text from public.embryo_cohorts c where c.id=(select cohort_id from live)),
    (select to_jsonb(w)::text from public.worker_jobs w where w.id=(select id from job))));
$$;

-- ---------------------------------------------------------------------------
-- Publication plans the cleanup
-- ---------------------------------------------------------------------------
select is((public.claim_embryo_split_job_v1(pg_temp.token(),'synthetic-worker')->>'attempt')::integer,1,
  'the split job is claimed');
select is(public.stage_embryo_split_variants_v1((select id from job),1,pg_temp.token(),0,0,
  '[[1,1000,"A","G","A/G"],[7,3000,"T","C","C/C"]]')->>'rows','2','embryo 1 stages its calls');
select is(public.stage_embryo_split_variants_v1((select id from job),1,pg_temp.token(),2,0,
  '[[22,9000,"C","T","C/T"]]')->>'rows','1','embryo 3 stages its call');
select is(pg_temp.land_parts(0,pg_temp.token()),2,'embryo 1 lands both canonical parts before passing');
select is(pg_temp.land_parts(2,pg_temp.token()),2,'embryo 3 lands both canonical parts before passing');
select is(public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),0,
  pg_temp.outcome('passed','pass','{}',10,2))->>'outcome','passed','embryo 1 passes');
select is(public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),1,
  pg_temp.outcome('qc_fail_no_source','fail',array['embryo_call_rate'],6,0,'embryo_call_rate'))->>'outcome',
  'qc_fail_no_source','embryo 2 fails QC');
select is(public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),2,
  pg_temp.outcome('passed','marginal',array['embryo_call_rate'],9,1))->>'outcome','passed','embryo 3 is marginal');
select is(public.publish_embryo_split_v1((select id from job),1,pg_temp.token())->>'status','published',
  'the cohort publishes');
insert into cleanup_plan select id from public.embryo_ingest_unwinds
  where purpose='published' and session_id=(select id from live);

select is((select count(*) from public.embryo_ingest_unwinds where purpose='published'
    and session_id=(select id from live)),1::bigint,'publication planned exactly one cleanup');
select is((select jsonb_build_object('state',state,'cohort',cohort_id=(select cohort_id from live),
    'revision',ingest_revision,'deadline',fixed_ingest_deadline=(select expires_at from live),
    'matrix',matrix_fingerprint,'recipients',recipients) from public.embryo_ingest_unwinds where id=pg_temp.unwind()),
  '{"state":"storage_pending","cohort":true,"revision":1,"deadline":true,"matrix":null,"recipients":null}'::jsonb,
  'the plan is waiting on storage and carries no recipient or matrix authority');
select is((select count(*) from public.embryo_ingest_delete_objects where unwind_id=pg_temp.unwind()),6::bigint,
  'the inventory lists all six fragment objects');
select ok((select bool_and(o.source_kind='ingest-fragment' and o.state='pending' and o.acknowledged_at is null
    and (o.bucket_id,o.object_name)=(f.bucket_id,f.object_name))
  from public.embryo_ingest_delete_objects o join public.embryo_ingest_fragments f on f.object_id=o.source_id
  where o.unwind_id=pg_temp.unwind()),
  'each at its exact fragment key, pending, and nothing else');
select ok((select public.embryo_ingest_unwind_work_v1(100) @> jsonb_build_array(jsonb_build_object(
    'unwindId',pg_temp.unwind(),'purpose','published','state','storage_pending'))),
  'the work list shows the published cleanup');
select is(public.prepare_embryo_ingest_unwind_v1((select cohort_id from live),1),'{"status":"published"}'::jsonb,
  'a published cohort still cannot be planned as abandoned');
select throws_ok($$select private.purge_embryo_ingest_attempt_v1(pg_temp.unwind())$$,
  '42501','embryo_unwind_unavailable','a published cleanup can never run the abandoned-attempt purge');
select throws_ok($$update public.embryo_ingest_unwinds set purpose='abandoned' where id=pg_temp.unwind()$$,
  '55000','embryo_unwind_identity','nor be relabelled as one');

create temporary table before_cleanup as select pg_temp.published() digest;

-- ---------------------------------------------------------------------------
-- Nothing is removed without exact evidence
-- ---------------------------------------------------------------------------
select is(public.complete_embryo_ingest_unwind_v1(pg_temp.unwind()),'{"status":"storage_pending"}'::jsonb,
  'the rows are not removed while storage is unconfirmed');
select is((public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.unwind())->'unresolved'->>'pending')::integer,6,
  'storage cannot be confirmed before any object is disposed of');
select is((select count(*) from public.embryo_ingest_fragments where session_id=(select id from live)),6::bigint,
  'every fragment row is still there');

create temporary table claim as select public.claim_embryo_ingest_object_disposals_v1(pg_temp.unwind(),repeat('a',64)) body;
select is((select jsonb_array_length(body->'objects') from claim),6,'all six objects are claimed');
select ok((select bool_and(value->>'operation'='delete' and value->>'backend'='supabase' and value->>'bucket'='genomes')
  from claim, jsonb_array_elements(body->'objects')),'each receipt asks for an exact Supabase delete');
create function pg_temp.evidence(d private.embryo_ingest_object_disposals) returns jsonb language sql as $$
  select jsonb_build_object('version','embryo-ingest-object-delete-evidence-v1','provider','supabase',
    'disposition','object-deleted','objectId',d.storage_object_id,'bucket',d.bucket_id,'objectKey',d.object_name,
    'storageVersion',d.storage_version,'byteCount',d.byte_count);
$$;
create function pg_temp.finish(p_ordinal bigint, p_evidence jsonb default null) returns jsonb language sql as $$
  select public.finish_embryo_ingest_object_disposal_v1(d.unwind_id,d.ordinal,repeat('a',64),
    private.embryo_ingest_disposal_receipt_v1(d),coalesce(p_evidence,pg_temp.evidence(d)))
  from private.embryo_ingest_object_disposals d where d.unwind_id=pg_temp.unwind() and d.ordinal=p_ordinal;
$$;
select throws_ok($$select pg_temp.finish(1)$$,'42501','embryo_unwind_unavailable',
  'a delete result is refused while the object''s metadata still exists');
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where id in (select storage_object_id from private.embryo_ingest_object_disposals
  where unwind_id=pg_temp.unwind());
select throws_ok($$select pg_temp.finish(1,(select pg_temp.evidence(d)||'{"byteCount":1}'
    from private.embryo_ingest_object_disposals d where d.unwind_id=pg_temp.unwind() and d.ordinal=1))$$,
  '22023','invalid_disposal_evidence','evidence for another size is refused');
select is(pg_temp.finish(o)->>'state','deleted',format('object %s is disposed of with its exact evidence',o))
  from generate_series(1,5) o;
select is(public.complete_embryo_ingest_unwind_v1(pg_temp.unwind()),'{"status":"storage_pending"}'::jsonb,
  'with one object still unproved nothing is removed');
select is((public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.unwind())->'unresolved'->>'pending')::integer,1,
  'and storage stays unconfirmed');
select is(pg_temp.finish(6)->>'state','deleted','the last object is disposed of');
select is(public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.unwind())->>'status','storage_confirmed',
  'the cleanup is storage_confirmed');

-- ---------------------------------------------------------------------------
-- Then the rows go, and only they do
-- ---------------------------------------------------------------------------
create temporary table done as select public.complete_embryo_ingest_unwind_v1(pg_temp.unwind()) body;
select is((select body - 'completedAt' from done),
  '{"status":"complete","objects":6,"fragments":6,"handles":3}'::jsonb,
  'the fragment, handle-map and inventory rows are removed');
select is((select count(*) from public.embryo_ingest_fragments where session_id=(select id from live))
  +(select count(*) from private.embryo_ingest_write_intents where session_id=(select id from live))
  +(select count(*) from public.embryo_fragment_handle_maps where session_id=(select id from live))
  +(select count(*) from public.embryo_ingest_delete_objects where unwind_id=pg_temp.unwind())
  +(select count(*) from private.embryo_ingest_object_disposals where unwind_id=pg_temp.unwind()),0::bigint,
  'no fragment, write intent, handle, inventory or disposal row remains');
select is((select count(*) from storage.objects so where so.bucket_id='genomes'
      and so.name like (select account_id::text||'/'||cohort_id::text||'/%' from live)),0::bigint,
  'no fragment object metadata remains in Storage');
select is((select count(*) from public.embryo_ingest_chunks where session_id=(select id from live)),2::bigint,
  'the stored chunk receipts stay with the published session');
select is(pg_temp.published(),(select digest from before_cleanup),
  'every published embryo, subject, QC row, genotype, the cohort and the job are exactly as published');
select is((select count(*) from public.embryo_variants v join public.embryos e on e.id=v.embryo_id
    where e.cohort_id=(select cohort_id from live)),3::bigint,'the three published genotypes remain');
select is((select count(*) from private.embryo_canonical_sources where cohort_id=(select cohort_id from live)),2::bigint,
  'both passing embryos retain their canonical sources');
select is((select count(*) from private.embryo_canonical_source_parts m join private.embryo_canonical_sources s
    on s.file_id=m.file_id where s.cohort_id=(select cohort_id from live)),4::bigint,
  'all four exact canonical membership rows remain after fragment cleanup');
select is((select count(*) from private.embryo_canonical_parts where session_id=(select id from live) and state='landed'),4::bigint,
  'all four landed canonical provider identities remain unchanged');
select is((select count(*) from public.embryo_qc q join public.embryos e on e.id=q.embryo_id
    where e.cohort_id=(select cohort_id from live)),3::bigint,'the three QC rows remain');
select is((select status from public.embryo_ingest_sessions where id=(select id from live)),'published',
  'the session stays published');
select is((select state||':'||(cohort_id is null and session_id is null and draft_id is null)::text
    from public.embryo_ingest_unwinds where id=pg_temp.unwind()),'complete:true',
  'the cleanup completes holding no live reference');
select is((select jsonb_build_object('event',event_code,'principal',audit_principal_id,'context',coded_context)
    from public.legal_audit_log order by seq desc limit 1),
  '{"event":"embryo.ingest.fragments-removed","principal":null,"context":{"objects":6,"fragments":6,"handles":3}}'::jsonb,
  'the audit event carries counts only');
select is(public.complete_embryo_ingest_unwind_v1(pg_temp.unwind()) - 'completedAt','{"status":"complete"}'::jsonb,
  'completing again is a no-op');
select ok(not (public.embryo_ingest_unwind_work_v1(100) @> jsonb_build_array(jsonb_build_object('unwindId',pg_temp.unwind()))),
  'a completed cleanup leaves the work list');
select is((select count(*) from public.embryo_terminal_mail where unwind_id=pg_temp.unwind()),0::bigint,
  'a published cleanup sends no terminal notice');

select * from finish();
rollback;
