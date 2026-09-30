begin;
select no_plan();
-- Restriction deletes the cohort's canonical sources (20260930150000). One
-- synthetic three-embryo upload publishes two sources. A second, unrelated
-- cohort holds a synthetic source of its own, and the owner has a file of
-- their own. Restriction must delete every source of its cohort, with its
-- parts following only after their markers are proved, and touch nothing
-- else. Genotypes, digests and provider identities are synthetic strings.
\ir fixtures/embryo_ingest_completed.inc
\ir fixtures/embryo_ingest_attempt.inc
update private.embryo_ingest_object_config set provider='supabase',r2_bucket='inherit-embryo-synthetic' where singleton;

update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
  claim_expires_at=null,claimed_by=null
  where kind='split_cohort_vcf' and id<>(select id from job) and status in ('queued','running');
update private.embryo_split_config set enabled=true;

create function pg_temp.token() returns text language sql as $$
  select encode(extensions.digest('synthetic-restriction-claim','sha256'),'hex');
$$;
create function pg_temp.outcome(p_outcome text,p_verdict text,p_rows integer) returns jsonb language sql as $$
  select jsonb_build_object('outcome',p_outcome,'qc',jsonb_build_object('sites_expected',10,
    'sites_called',case p_outcome when 'passed' then 10 else 6 end,
    'call_rate',case p_outcome when 'passed' then 1 else 0.6 end,'autosomal_het_rate',0.4,'mean_depth',12.5,
    'qc_verdict',p_verdict,'qc_reasons',case p_outcome when 'passed' then '[]'::jsonb else '["embryo_call_rate"]'::jsonb end),
    'failureReason',case p_outcome when 'passed' then null else 'embryo_call_rate' end,'variantCount',p_rows);
$$;
create function pg_temp.restrict(p_nonce text) returns void language sql as $$
  select public.restrict_embryo_cohort_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',(select cohort_id from live),p_nonce);
$$;

-- ---------------------------------------------------------------------------
-- The published cohort
-- ---------------------------------------------------------------------------
select is((public.claim_embryo_split_job_v1(pg_temp.token(),'synthetic-worker')->>'attempt')::integer,1,
  'the split job is claimed');
select is(public.stage_embryo_split_variants_v1((select id from job),1,pg_temp.token(),0,0,
  '[[1,1000,"A","G","A/G"],[7,3000,"T","C","C/C"]]')->>'rows','2','embryo 1 stages its calls');
select is(public.stage_embryo_split_variants_v1((select id from job),1,pg_temp.token(),2,0,
  '[[22,9000,"C","T","C/T"]]')->>'rows','1','embryo 3 stages its call');
select is(pg_temp.land_parts(0,pg_temp.token())+pg_temp.land_parts(2,pg_temp.token()),4,
  'embryos 1 and 3 are copied into canonical parts');
select is(public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),0,
  pg_temp.outcome('passed','pass',2))->>'outcome','passed','embryo 1 passes');
select is(public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),1,
  pg_temp.outcome('qc_fail_no_source','fail',0))->>'outcome','qc_fail_no_source','embryo 2 fails QC');
select is(public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),2,
  pg_temp.outcome('passed','marginal',1))->>'outcome','passed','embryo 3 is marginal');
select is(public.publish_embryo_split_v1((select id from job),1,pg_temp.token())->>'status','published',
  'the cohort publishes two sources');
create temporary table sources as select x.file_id, x.embryo_id, x.subject_id from private.embryo_canonical_sources x
  where x.cohort_id=(select cohort_id from live);
create temporary table source_parts as select m.part_id id, p.provider_bucket||'/'||p.provider_key object
  from private.embryo_canonical_source_parts m join private.embryo_canonical_parts p on p.id=m.part_id
  where m.file_id in (select file_id from sources);
select is((select count(*) from sources),2::bigint,'two canonical sources exist');
select is((select count(*) from source_parts),4::bigint,'they bind four parts');

-- ---------------------------------------------------------------------------
-- Rows restriction must not touch
-- ---------------------------------------------------------------------------
-- The owner's own file.
insert into public.genome_files(user_id,bucket_path,original_name,file_type,tier,size_bytes,status,subject_id)
  select '7a000000-0000-0000-0000-000000000001',gen_random_uuid()::text,'synthetic-self.txt','array_23andme',1,100,'stored',
    (select id from public.subjects where owner_account_id='7a000000-0000-0000-0000-000000000001' and subject_class='self');
-- An unrelated cohort with a canonical source of its own: its file, source,
-- membership and part mirror a published source's shape, bound to its own
-- embryo, subject, cohort and session.
create temporary table sibling(session uuid, cohort uuid, embryo uuid, subject uuid, file uuid, part uuid);
insert into sibling(session) select pg_temp.new_attempt();
update sibling set cohort=(select cohort_id from public.embryo_ingest_sessions where id=sibling.session);
update sibling set embryo=e.id, subject=e.subject_id from public.embryos e where e.cohort_id=sibling.cohort and e.sample_ordinal=0;
update sibling set file=gen_random_uuid(), part=gen_random_uuid();
insert into public.genome_files
  select (jsonb_populate_record(null::public.genome_files, to_jsonb(g)||jsonb_build_object('id',(select file from sibling),
    'subject_id',(select subject from sibling),
    'user_id',(select account_id from public.embryo_ingest_sessions where id=(select session from sibling)),
    'bucket_path','embryo-source/'||(select file from sibling)))).*
  from public.genome_files g where g.id=(select min(file_id::text)::uuid from sources);
insert into private.embryo_canonical_parts
  select (jsonb_populate_record(null::private.embryo_canonical_parts, to_jsonb(p)||jsonb_build_object('id',(select part from sibling),
    'session_id',(select session from sibling),'attempt',20,'sample_ordinal',0,'sequence',0,
    'provider_key','embryo/'||gen_random_uuid()))).*
  from private.embryo_canonical_parts p where p.id=(select min(id::text)::uuid from source_parts);
insert into private.embryo_canonical_sources
  select (jsonb_populate_record(null::private.embryo_canonical_sources, to_jsonb(x)||jsonb_build_object(
    'file_id',(select file from sibling),'embryo_id',(select embryo from sibling),'subject_id',(select subject from sibling),
    'cohort_id',(select cohort from sibling),'session_id',(select session from sibling),'sample_ordinal',0,
    'part_count',1,'call_immutability_proof',null))).*
  from private.embryo_canonical_sources x where x.file_id=(select min(file_id::text)::uuid from sources);
insert into private.embryo_canonical_source_parts(file_id,part_id,sequence)
  select file,part,0 from sibling;
create function pg_temp.untouched() returns text language sql as $$
  select md5(concat_ws('|',
    (select string_agg(to_jsonb(g)::text,',' order by g.id) from public.genome_files g
      where g.id=(select file from sibling) or g.original_name='synthetic-self.txt'),
    (select to_jsonb(x)::text from private.embryo_canonical_sources x where x.file_id=(select file from sibling)),
    (select to_jsonb(m)::text from private.embryo_canonical_source_parts m where m.file_id=(select file from sibling)),
    (select to_jsonb(p)::text from private.embryo_canonical_parts p where p.id=(select part from sibling)),
    (select string_agg(to_jsonb(e)::text,',' order by e.id) from public.embryos e where e.cohort_id=(select cohort from sibling)),
    (select to_jsonb(c)::text from public.embryo_cohorts c where c.id=(select cohort from sibling))));
$$;
create temporary table untouched_before as select pg_temp.untouched() digest;
select is((select count(*) from private.embryo_canonical_sources),
  (select count(*) from private.embryo_canonical_sources where cohort_id in ((select cohort_id from live),(select cohort from sibling))),
  'the fixture sources are the only canonical sources here');

-- ---------------------------------------------------------------------------
-- Restriction
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('service_role','public.restrict_embryo_cohort_v1(uuid,uuid,uuid,text)','EXECUTE'),
  'the service role still reaches the restriction door');
select ok(not has_function_privilege(r,'public.restrict_embryo_cohort_v1(uuid,uuid,uuid,text)','EXECUTE'),
  format('%s still cannot',r)) from unnest(array['anon','authenticated']) r;
select is((select pg_get_function_identity_arguments('public.restrict_embryo_cohort_v1(uuid,uuid,uuid,text)'::regprocedure)),
  'p_account_id uuid, p_session_id uuid, p_cohort_id uuid, p_token_nonce text','the door''s signature is unchanged');

-- The helper both restriction paths call.
select ok(not has_function_privilege(r,'private.delete_embryo_cohort_sources_v1(uuid,text)','EXECUTE'),
  format('%s cannot call the cohort source-deletion helper',r))
  from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r;
select throws_ok($$select private.delete_embryo_cohort_sources_v1((select cohort_id from live),'retention-deadline')$$,
  '22023','invalid_request','the helper takes only restriction or withdrawal');
select throws_ok($$select private.delete_embryo_cohort_sources_v1(gen_random_uuid(),'withdrawal')$$,
  '42501','cohort unavailable','the helper refuses an unknown cohort');
create temporary table empty_cohort(session uuid, id uuid);
insert into empty_cohort(session) select pg_temp.new_attempt();
update empty_cohort set id=(select cohort_id from public.embryo_ingest_sessions where id=empty_cohort.session);
select isnt((select id from empty_cohort),null,'a second, empty cohort exists');
select is(private.delete_embryo_cohort_sources_v1((select id from empty_cohort),'withdrawal'),
  '{"status":"none","sources":0}'::jsonb,'a cohort with no canonical source is a no-op');
create function pg_temp.helper_probe() returns text language plpgsql as $$
declare v jsonb; n bigint;
begin
  begin
    v:=private.delete_embryo_cohort_sources_v1((select cohort_id from live),'withdrawal');
    select count(*) into n from private.embryo_canonical_sources where cohort_id=(select cohort_id from live);
    raise exception using errcode='ZY001',message=(v-'unwindId')::text||' / '||n;
  exception when sqlstate 'ZY001' then return sqlerrm;
  end;
end $$;
select is(pg_temp.helper_probe(),
  '{"parts": 4, "status": "storage_pending", "sources": 2, "genotypes": 3} / 0',
  'called directly for a withdrawal, the helper plans every source of the cohort (rolled back here)');
select is((select count(*) from private.embryo_canonical_sources where cohort_id=(select cohort_id from live)),2::bigint,
  'the probe left both sources in place');

-- Anything else that depends on a source file refuses the whole restriction.
create table public.zz_restriction_dependant_probe(file_ref uuid);
insert into public.zz_restriction_dependant_probe select min(file_id::text)::uuid from sources;
select throws_ok($$select pg_temp.restrict('nonce-restrict-refused-0001')$$,'55000','embryo_source_dependants',
  'a dependant row elsewhere refuses the restriction');
drop table public.zz_restriction_dependant_probe;
select is((select status from public.embryo_cohorts where id=(select cohort_id from live)),'active',
  'a refused restriction restricted nothing');
select is((select count(*) from public.genome_files where id in (select file_id from sources)),2::bigint,
  'and deleted nothing');

select lives_ok($$select pg_temp.restrict('nonce-restrict-sources-0001')$$,'a disposition authority restricts the cohort');
select is((select status from public.embryo_cohorts where id=(select cohort_id from live)),'restricted',
  'the cohort is restricted');
select is((select count(*) from private.embryo_canonical_source_parts where file_id in (select file_id from sources))
  +(select count(*) from private.embryo_canonical_sources where cohort_id=(select cohort_id from live))
  +(select count(*) from public.embryo_variants v join public.embryos e on e.id=v.embryo_id
    where e.cohort_id=(select cohort_id from live))
  +(select count(*) from public.genome_files where id in (select file_id from sources))
  +(select count(*) from public.genome_files g join public.subjects x on x.id=g.subject_id
    where x.cohort_id=(select cohort_id from live))
  +(select count(*) from public.embryo_qc q join public.embryos e on e.id=q.embryo_id
    where e.cohort_id=(select cohort_id from live)),0::bigint,
  'no membership, source, genotype, file row or QC row of the restricted cohort survives');
select is(private.embryo_ingest_attempt_residue_v1((select array_agg(file_id) from sources),'{}'),
  '{"registered":{},"unregistered":{},"unverifiable":0}'::jsonb,
  'no store anywhere names a deleted source file');
select is(pg_temp.untouched(),(select digest from untouched_before),
  'the other cohort''s source, file, membership, part and embryos, and the owner''s own file, are untouched');
create temporary table source_unwind as select id from public.embryo_ingest_unwinds
  where purpose='source' and session_id=(select id from live);
select is((select count(*) from source_unwind),1::bigint,'one source unwind holds the parts');
select is((select array_agg(o.source_id order by o.source_id) from public.embryo_ingest_delete_objects o
    where o.unwind_id=(select id from source_unwind)),(select array_agg(id order by id) from source_parts),
  'its inventory is exactly the four parts the deleted sources bound');
select is((select count(*) from private.embryo_canonical_parts where id in (select id from source_parts)),4::bigint,
  'the part rows stay until their markers are proved');
select is((select jsonb_build_object('event',event_code,'context',coded_context) from public.legal_audit_log
    where event_code='embryo.source.deletion-planned' order by seq desc limit 1),
  '{"event":"embryo.source.deletion-planned","context":{"reason":"restriction","sources":2,"parts":4,"genotypes":0}}'::jsonb,
  'the planner records a counts-only event for the restriction');
select throws_ok($$select pg_temp.restrict('nonce-restrict-sources-0002')$$,'55000','already restricted',
  'a restricted cohort cannot be restricted again');

-- ---------------------------------------------------------------------------
-- The parts' disposal
-- ---------------------------------------------------------------------------
select is(public.complete_embryo_ingest_unwind_v1((select id from source_unwind)),'{"status":"storage_pending"}'::jsonb,
  'nothing more is removed before the markers are proved');
create temporary table claim as select public.claim_embryo_ingest_object_disposals_v1((select id from source_unwind),repeat('a',64)) body;
select is((select jsonb_array_length(body->'objects') from claim),4,'the four parts are claimed');
select ok((select bool_and(value->>'operation'='tombstone' and (value->>'bucket')||'/'||(value->>'objectKey')
    in (select object from source_parts)) from claim, jsonb_array_elements(body->'objects')),
  'each for an empty marker at its exact key');
select is((select count(*) from (select public.finish_embryo_ingest_object_disposal_v1(d.unwind_id,d.ordinal,repeat('a',64),
    private.embryo_ingest_disposal_receipt_v1(d),jsonb_build_object('version','embryo-ingest-object-tombstone-evidence-v1',
      'provider','r2','disposition','payload-tombstoned','bucket',d.bucket_id,'objectKey',d.object_name,
      'providerVersion',lpad(d.ordinal::text,32,'9'),'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,
      'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'))->>'state' s
  from private.embryo_ingest_object_disposals d where d.unwind_id=(select id from source_unwind)) x
  where s='tombstoned'),4::bigint,'each marker is recorded with its exact evidence');
select is(public.confirm_embryo_ingest_unwind_storage_v1((select id from source_unwind))->>'status','storage_confirmed',
  'the source unwind is storage_confirmed');
select is(public.complete_embryo_ingest_unwind_v1((select id from source_unwind)) - 'completedAt',
  '{"status":"complete","parts":4}'::jsonb,'then the part rows are deleted');
select is(private.embryo_ingest_attempt_residue_v1((select array_agg(id) from source_parts)
    ||(select array_agg(file_id) from sources),(select array_agg(object) from source_parts)),
  '{"registered":{},"unregistered":{},"unverifiable":0}'::jsonb,
  'no store names a deleted file or part');
select is(pg_temp.untouched(),(select digest from untouched_before),'the other cohort and the owner''s file are still untouched');

select * from finish();
rollback;
