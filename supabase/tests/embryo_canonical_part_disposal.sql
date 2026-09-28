begin;
select no_plan();
-- Canonical parts and sources in the unwind machinery (20260930140000).
-- One synthetic three-embryo upload: attempt one copies embryo 1 and starts a
-- copy for embryo 3, then fails transiently; attempt two publishes embryos 1
-- and 3 from new copies. The published cleanup must dispose of attempt one's
-- three unbound parts and never a bound one. Then the source-deletion planner
-- removes the published sources one at a time. Genotypes, digests and
-- provider identities are synthetic strings.
\ir fixtures/embryo_ingest_completed.inc

update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
  claim_expires_at=null,claimed_by=null
  where kind='split_cohort_vcf' and id<>(select id from job) and status in ('queued','running');
update private.embryo_split_config set enabled=true;

create function pg_temp.token(p text) returns text language sql as $$
  select encode(extensions.digest('synthetic-part-claim:'||p,'sha256'),'hex');
$$;
create function pg_temp.outcome(p_outcome text,p_verdict text,p_rows integer) returns jsonb language sql as $$
  select jsonb_build_object('outcome',p_outcome,'qc',jsonb_build_object('sites_expected',10,
    'sites_called',case p_outcome when 'passed' then 10 else 6 end,
    'call_rate',case p_outcome when 'passed' then 1 else 0.6 end,'autosomal_het_rate',0.4,'mean_depth',12.5,
    'qc_verdict',p_verdict,'qc_reasons',case p_outcome when 'passed' then '[]'::jsonb else '["embryo_call_rate"]'::jsonb end),
    'failureReason',case p_outcome when 'passed' then null else 'embryo_call_rate' end,'variantCount',p_rows);
$$;
create temporary table plans(label text primary key, id uuid);
create function pg_temp.uid(p_label text) returns uuid language sql as $$
  select id from plans where label=p_label;
$$;
-- Claim and dispose of every claimable object with its exact evidence.
create function pg_temp.dispose_all(p_label text) returns integer language plpgsql as $$
declare v jsonb; d private.embryo_ingest_object_disposals; n integer:=0;
begin
  v:=public.claim_embryo_ingest_object_disposals_v1(pg_temp.uid(p_label),repeat('a',64));
  if v->>'status'<>'claimed' then raise exception 'nothing claimed: %',v; end if;
  perform set_config('storage.allow_delete_query','true',true);
  for d in select * from private.embryo_ingest_object_disposals where unwind_id=pg_temp.uid(p_label) and state='claimed'
    order by ordinal loop
    if d.backend='supabase' then
      delete from storage.objects where id=d.storage_object_id;
      perform public.finish_embryo_ingest_object_disposal_v1(d.unwind_id,d.ordinal,repeat('a',64),
        private.embryo_ingest_disposal_receipt_v1(d),
        jsonb_build_object('version','embryo-ingest-object-delete-evidence-v1','provider','supabase',
          'disposition','object-deleted','objectId',d.storage_object_id,'bucket',d.bucket_id,'objectKey',d.object_name,
          'storageVersion',d.storage_version,'byteCount',d.byte_count));
    else
      perform public.finish_embryo_ingest_object_disposal_v1(d.unwind_id,d.ordinal,repeat('a',64),
        private.embryo_ingest_disposal_receipt_v1(d),
        jsonb_build_object('version','embryo-ingest-object-tombstone-evidence-v1','provider','r2',
          'disposition','payload-tombstoned','bucket',d.bucket_id,'objectKey',d.object_name,
          'providerVersion',lpad(d.ordinal::text,32,'9'),'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,
          'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'));
    end if;
    n:=n+1;
  end loop;
  return n;
end $$;
create function pg_temp.bound() returns bigint language sql as $$
  select count(*) from private.embryo_canonical_parts p join private.embryo_canonical_source_parts m on m.part_id=p.id
    where p.session_id=(select id from live);
$$;
-- Everything published about the cohort that a part disposal must not touch.
create function pg_temp.published() returns text language sql as $$
  select md5(concat_ws('|',
    (select string_agg(to_jsonb(e)::text,',' order by e.sample_ordinal) from public.embryos e
      where e.cohort_id=(select cohort_id from live)),
    (select string_agg(to_jsonb(q)::text,',' order by q.embryo_id) from public.embryo_qc q
      join public.embryos e on e.id=q.embryo_id where e.cohort_id=(select cohort_id from live)),
    (select string_agg(to_jsonb(v)::text,',' order by v.embryo_id,v.chromosome,v.position) from public.embryo_variants v
      join public.embryos e on e.id=v.embryo_id where e.cohort_id=(select cohort_id from live)),
    (select string_agg(to_jsonb(g)::text,',' order by g.id) from public.genome_files g
      join public.subjects x on x.id=g.subject_id where x.cohort_id=(select cohort_id from live)),
    (select string_agg(to_jsonb(x)::text,',' order by x.file_id) from private.embryo_canonical_sources x
      where x.cohort_id=(select cohort_id from live)),
    (select string_agg(to_jsonb(p)::text||to_jsonb(m)::text,',' order by p.id) from private.embryo_canonical_parts p
      join private.embryo_canonical_source_parts m on m.part_id=p.id where p.session_id=(select id from live))));
$$;

-- ---------------------------------------------------------------------------
-- Attempt one: a copied embryo, a copy left open, then a transient failure
-- ---------------------------------------------------------------------------
select is((public.claim_embryo_split_job_v1(pg_temp.token('a'),'synthetic-worker')->>'attempt')::integer,1,
  'attempt one is claimed');
select is(pg_temp.land_parts(0,pg_temp.token('a')),2,'attempt one copies embryo 1''s two fragments');
-- A short claim bounds the next part's write window.
update public.worker_jobs set claim_expires_at=clock_timestamp()+interval '2 seconds' where id=(select id from job);
select is(public.reserve_embryo_canonical_part_v1((select id from job),1,pg_temp.token('a'),2,0)->>'backend','r2',
  'attempt one reserves a part for embryo 3 and never lands it');
select is(public.fail_embryo_split_attempt_v1((select id from job),1,pg_temp.token('a'),'transient')->>'status','queued',
  'attempt one fails transiently and the job is requeued');
create temporary table attempt_one as select id, state from private.embryo_canonical_parts
  where worker_job_id=(select id from job) and attempt=1;
select is((select string_agg(state,',' order by state) from attempt_one),'landed,landed,open',
  'attempt one left two landed parts and one open part');

-- ---------------------------------------------------------------------------
-- Attempt two publishes from its own new copies
-- ---------------------------------------------------------------------------
update public.worker_jobs set not_before=clock_timestamp() where id=(select id from job);
select is((public.claim_embryo_split_job_v1(pg_temp.token('b'),'synthetic-worker')->>'attempt')::integer,2,
  'attempt two is claimed');
select is(public.stage_embryo_split_variants_v1((select id from job),2,pg_temp.token('b'),0,0,
  '[[1,1000,"A","G","A/G"],[7,3000,"T","C","C/C"]]')->>'rows','2','embryo 1 stages its calls');
select is(public.stage_embryo_split_variants_v1((select id from job),2,pg_temp.token('b'),2,0,
  '[[22,9000,"C","T","C/T"]]')->>'rows','1','embryo 3 stages its call');
select is(pg_temp.land_parts(0,pg_temp.token('b'),2)+pg_temp.land_parts(2,pg_temp.token('b'),2),4,
  'attempt two copies embryos 1 and 3 into new parts');
select is(public.finish_embryo_split_ordinal_v1((select id from job),2,pg_temp.token('b'),0,
  pg_temp.outcome('passed','pass',2))->>'outcome','passed','embryo 1 passes');
select is(public.finish_embryo_split_ordinal_v1((select id from job),2,pg_temp.token('b'),1,
  pg_temp.outcome('qc_fail_no_source','fail',0))->>'outcome','qc_fail_no_source','embryo 2 fails QC');
select is(public.finish_embryo_split_ordinal_v1((select id from job),2,pg_temp.token('b'),2,
  pg_temp.outcome('passed','marginal',1))->>'outcome','passed','embryo 3 is marginal');
select is(public.publish_embryo_split_v1((select id from job),2,pg_temp.token('b'))->>'status','published',
  'attempt two publishes');
select is(pg_temp.bound(),4::bigint,'the two published sources bind four parts of attempt two');
insert into plans select 'published', id from public.embryo_ingest_unwinds
  where purpose='published' and session_id=(select id from live);
create temporary table before_cleanup as select pg_temp.published() digest;

-- ---------------------------------------------------------------------------
-- The published cleanup: fragments and unbound parts only
-- ---------------------------------------------------------------------------
select is((select count(*) from public.embryo_ingest_delete_objects where unwind_id=pg_temp.uid('published')),9::bigint,
  'the cleanup lists six fragments and attempt one''s three parts');
select is((select array_agg(o.source_id order by o.source_id) from public.embryo_ingest_delete_objects o
    where o.unwind_id=pg_temp.uid('published') and o.source_kind='canonical-part'),
  (select array_agg(id order by id) from attempt_one),
  'exactly the unbound parts are listed, landed or not, each at its own key');
select is((select count(*) from public.embryo_ingest_delete_objects o join private.embryo_canonical_source_parts m
    on m.part_id=o.source_id where o.source_kind='canonical-part'),0::bigint,'no inventory lists a bound part');
select pg_sleep(greatest(0,extract(epoch from (select max(write_expires_at) from private.embryo_canonical_parts
  where id in (select id from attempt_one))-clock_timestamp()))+0.05);
select is(public.complete_embryo_ingest_unwind_v1(pg_temp.uid('published')),'{"status":"storage_pending"}'::jsonb,
  'nothing is removed before storage is confirmed');
select is(pg_temp.dispose_all('published'),9,'every listed object is disposed of with exact evidence');
select is((select count(*) from private.embryo_ingest_object_disposals d join attempt_one a on true
    join private.embryo_canonical_parts p on p.id=a.id
    where d.unwind_id=pg_temp.uid('published') and d.backend='r2' and (d.bucket_id,d.object_name)=(p.provider_bucket,p.provider_key)
      and d.intent_state=case a.state when 'landed' then 'landed' else 'uncertain' end),3::bigint,
  'each part got the R2 marker path: the landed ones as landed, the open one as uncertain');
select is(public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.uid('published'))->>'status','storage_confirmed',
  'the cleanup is storage_confirmed');
select is(public.complete_embryo_ingest_unwind_v1(pg_temp.uid('published')) - 'completedAt',
  '{"status":"complete","objects":9,"fragments":6,"handles":3,"parts":3}'::jsonb,
  'the cleanup removes the fragment rows and the three unbound part rows');
select is((select count(*) from private.embryo_canonical_parts where id in (select id from attempt_one)),0::bigint,
  'attempt one''s part rows are gone');
select is(pg_temp.bound(),4::bigint,'every bound part stays');
select is(pg_temp.published(),(select digest from before_cleanup),
  'every published row, source, file and bound part is exactly as published');

-- ---------------------------------------------------------------------------
-- The source-deletion planner
-- ---------------------------------------------------------------------------
create temporary table sources as select s.file_id, s.sample_ordinal, s.embryo_id, s.subject_id
  from private.embryo_canonical_sources s where s.cohort_id=(select cohort_id from live);
create function pg_temp.file(p_ordinal integer) returns uuid language sql as $$
  select file_id from sources where sample_ordinal=p_ordinal;
$$;
create function pg_temp.plan_delete(p_files uuid[],p_reason text) returns jsonb language sql as $$
  select private.plan_embryo_source_deletion_v1(p_files,p_reason);
$$;
select ok(not has_function_privilege(r,'private.plan_embryo_source_deletion_v1(uuid[],text)','EXECUTE'),
  format('%s cannot call the planner',r)) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r;
select throws_ok($$select pg_temp.plan_delete(array[pg_temp.file(0)],'because')$$,'22023','invalid_request',
  'a reason outside the closed set is refused');
select throws_ok($$select pg_temp.plan_delete('{}'::uuid[],'restriction')$$,'22023','invalid_request',
  'an empty plan is refused');
select throws_ok($$select pg_temp.plan_delete(array[pg_temp.file(0),pg_temp.file(0)],'restriction')$$,'22023',
  'invalid_request','a repeated file is refused');
select throws_ok($$select pg_temp.plan_delete(array[pg_temp.file(0),gen_random_uuid()],'restriction')$$,'42501',
  'embryo_source_unavailable','a file that is not a canonical source is refused');
-- Anything outside the source's own rows that names its file stops the plan.
create table public.zz_source_dependant_probe(file_ref uuid);
insert into public.zz_source_dependant_probe select pg_temp.file(0);
select throws_ok($$select pg_temp.plan_delete(array[pg_temp.file(0)],'restriction')$$,'55000',
  'embryo_source_dependants','a row elsewhere that depends on the file refuses the plan');
drop table public.zz_source_dependant_probe;
select is((select count(*) from sources s join public.genome_files g on g.id=s.file_id),2::bigint,
  'a refused plan deleted nothing');

create temporary table plan0 as select pg_temp.plan_delete(array[pg_temp.file(0)],'restriction') body;
insert into plans select 'source0',(body->>'unwindId')::uuid from plan0;
select is((select body - 'unwindId' from plan0),
  '{"status":"storage_pending","sources":1,"parts":2,"genotypes":2}'::jsonb,
  'embryo 1''s source is planned for deletion: one source, two parts, two genotypes');
select is((select count(*) from private.embryo_canonical_source_parts where file_id=pg_temp.file(0))
  +(select count(*) from private.embryo_canonical_sources where file_id=pg_temp.file(0))
  +(select count(*) from public.embryo_variants where source_file_id=pg_temp.file(0))
  +(select count(*) from public.genome_files where id=pg_temp.file(0)),0::bigint,
  'its membership, source, genotypes and file row are gone in the same transaction');
select is(private.embryo_ingest_attempt_residue_v1(array[pg_temp.file(0)],'{}'),
  '{"registered":{},"unregistered":{},"unverifiable":0}'::jsonb,'no store names the deleted file');
select is((select count(*) from public.embryo_qc where embryo_id=(select embryo_id from sources where sample_ordinal=0)),
  1::bigint,'the embryo''s QC row is not part of its source and stays');
select is((select count(*) from private.embryo_canonical_sources where file_id=pg_temp.file(2)),1::bigint,
  'embryo 3''s source is untouched');
select is((select jsonb_build_object('purpose',purpose,'state',state,'cohort',cohort_id,
    'session',session_id=(select id from live)) from public.embryo_ingest_unwinds where id=pg_temp.uid('source0')),
  '{"purpose":"source","state":"storage_pending","cohort":null,"session":true}'::jsonb,
  'the parts wait under a source unwind');
select is((select count(*) from public.embryo_ingest_delete_objects o join private.embryo_canonical_parts p
    on p.id=o.source_id and (p.provider_bucket,p.provider_key)=(o.bucket_id,o.object_name)
    where o.unwind_id=pg_temp.uid('source0') and o.source_kind='canonical-part'),2::bigint,
  'its inventory lists the two unbound part rows at their exact keys');
select throws_ok($$select pg_temp.plan_delete(array[pg_temp.file(0)],'restriction')$$,'42501',
  'embryo_source_unavailable','a deleted source cannot be planned again');
select is(public.complete_embryo_ingest_unwind_v1(pg_temp.uid('source0')),'{"status":"storage_pending"}'::jsonb,
  'the part rows stay until their markers are proved');
select is(pg_temp.dispose_all('source0'),2,'both parts get a verified marker');
select is(public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.uid('source0'))->>'status','storage_confirmed',
  'the source unwind is storage_confirmed');
create temporary table source0_parts as select source_id id from public.embryo_ingest_delete_objects
  where unwind_id=pg_temp.uid('source0');
select is(public.complete_embryo_ingest_unwind_v1(pg_temp.uid('source0')) - 'completedAt',
  '{"status":"complete","parts":2}'::jsonb,'then the part rows are deleted');
select is(private.embryo_ingest_attempt_residue_v1((select array_agg(id) from source0_parts),'{}'),
  '{"registered":{},"unregistered":{},"unverifiable":0}'::jsonb,'no store names a deleted part');
select is((select jsonb_build_object('event',event_code,'context',coded_context)
    from public.legal_audit_log order by seq desc limit 1),
  '{"event":"embryo.source.parts-removed","context":{"parts":2}}'::jsonb,'the audit event carries counts only');
select is(public.complete_embryo_ingest_unwind_v1(pg_temp.uid('source0')) - 'completedAt','{"status":"complete"}'::jsonb,
  'completing again is a no-op');

create temporary table plan2 as select pg_temp.plan_delete(array[pg_temp.file(2)],'retention-deadline') body;
select is((select body - 'unwindId' from plan2),
  '{"status":"storage_pending","sources":1,"parts":2,"genotypes":1}'::jsonb,
  'embryo 3''s source is planned at its retention deadline');
select is(pg_temp.bound(),0::bigint,'no part is bound any more');
select is((select count(*) from private.embryo_canonical_parts where session_id=(select id from live)),2::bigint,
  'only embryo 3''s two parts remain, awaiting their markers');
select is((select count(*) from public.embryo_qc q join public.embryos e on e.id=q.embryo_id
    where e.cohort_id=(select cohort_id from live)),3::bigint,'every QC row stays');

select * from finish();
rollback;
