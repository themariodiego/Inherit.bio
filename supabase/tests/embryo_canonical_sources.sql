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
create function pg_temp.token(p text) returns text language sql as $$
  select encode(extensions.digest('synthetic-canonical-claim:'||p,'sha256'),'hex');
$$;
create function pg_temp.reserve(p_ordinal integer,p_sequence integer,p text default 'a',p_attempt integer default 1)
returns jsonb language sql as $$
  select public.reserve_embryo_canonical_part_v1((select id from job),p_attempt,pg_temp.token(p),p_ordinal,p_sequence);
$$;
-- ACK a receipt as the transport would after reading it back; any observed
-- value can be overridden to plant a mismatch.
create function pg_temp.ack(t jsonb,p text default 'a',p_attempt integer default 1,p_version text default null,
  p_etag text default null,p_sha256 text default null,p_bytes bigint default null) returns jsonb language sql as $$
  select public.ack_embryo_canonical_part_v1((select id from job),p_attempt,pg_temp.token(p),
    (t->>'sessionId')::uuid,(t->>'sequence')::integer,(t->>'ordinal')::integer,t,
    coalesce(p_version,md5('version:'||(t->>'objectKey'))),coalesce(p_etag,md5('etag:'||(t->>'objectKey'))),
    coalesce(p_sha256,t->>'sha256'),coalesce(p_bytes,(t->>'byteCount')::bigint));
$$;
create function pg_temp.stage(p_ordinal integer,p_batch integer,p_rows jsonb,p text default 'a',p_attempt integer default 1)
returns jsonb language sql as $$
  select public.stage_embryo_split_variants_v1((select id from job),p_attempt,pg_temp.token(p),p_ordinal,p_batch,p_rows);
$$;
-- The bare door: this suite lands parts itself.
create function pg_temp.finish(p_ordinal integer,p_result jsonb,p text default 'a',p_attempt integer default 1)
returns jsonb language sql as $$
  select public.finish_embryo_split_ordinal_v1((select id from job),p_attempt,pg_temp.token(p),p_ordinal,p_result);
$$;
create function pg_temp.fail(p_reason text,p text default 'a',p_attempt integer default 1) returns jsonb language sql as $$
  select public.fail_embryo_split_attempt_v1((select id from job),p_attempt,pg_temp.token(p),p_reason);
$$;
create function pg_temp.publish(p text,p_attempt integer) returns jsonb language sql as $$
  select public.publish_embryo_split_v1((select id from job),p_attempt,pg_temp.token(p));
$$;
create function pg_temp.passed(p_count integer) returns jsonb language sql as $$
  select jsonb_build_object('outcome','passed','qc',jsonb_build_object('figure_basis',pg_temp.qc_receipt(0.25,null),'sites_expected',8,'sites_called',8,
    'call_rate',1,'autosomal_het_rate',0.25,'mean_depth',null,'qc_verdict','pass','qc_reasons','[]'::jsonb),
    'failureReason',null,'variantCount',p_count);
$$;
create function pg_temp.failed() returns jsonb language sql as $$
  select jsonb_build_object('outcome','qc_fail_no_source','qc',jsonb_build_object('figure_basis',pg_temp.qc_receipt(0.25,null),'sites_expected',8,'sites_called',4,
    'call_rate',0.5,'autosomal_het_rate',0.25,'mean_depth',null,'qc_verdict','fail',
    'qc_reasons',jsonb_build_array('embryo_call_rate')),'failureReason','embryo_call_rate','variantCount',0);
$$;
create function pg_temp.rows() returns jsonb language sql as $$
  select '[[1,22133085,"T","C","C/C"],[1,22153726,"C","G","C/G"],[2,1000,"A",null,"A/A"]]'::jsonb;
$$;
create function pg_temp.part(t jsonb) returns private.embryo_canonical_parts language sql as $$
  select * from private.embryo_canonical_parts where provider_key=t->>'objectKey';
$$;

-- ---------------------------------------------------------------------------
-- Stores, doors and the purge inventory
-- ---------------------------------------------------------------------------
select is((select count(*) from unnest(array['private.embryo_canonical_parts','private.embryo_canonical_sources',
    'private.embryo_canonical_source_parts']) t, unnest(array['anon','authenticated','service_role']) r
  where has_table_privilege(r,t,'select') or has_table_privilege(r,t,'insert')
    or has_table_privilege(r,t,'update') or has_table_privilege(r,t,'delete')),0::bigint,
  'no API role can read or write a canonical store directly');
select ok(has_function_privilege('service_role','public.reserve_embryo_canonical_part_v1(uuid,integer,text,integer,integer)','execute')
  and has_function_privilege('service_role',
    'public.ack_embryo_canonical_part_v1(uuid,integer,text,uuid,integer,integer,jsonb,text,text,text,bigint)','execute'),
  'the operator worker reaches both part doors');
select ok(not has_function_privilege('authenticated','public.reserve_embryo_canonical_part_v1(uuid,integer,text,integer,integer)','execute')
  and not has_function_privilege('authenticated',
    'public.ack_embryo_canonical_part_v1(uuid,integer,text,uuid,integer,integer,jsonb,text,text,text,bigint)','execute')
  and not has_function_privilege('anon','public.reserve_embryo_canonical_part_v1(uuid,integer,text,integer,integer)','execute'),
  'signed-in and anonymous clients reach neither part door');
select is((select array_agg(target_id||':'||store_name order by store_order) from public.purge_target_stores
  where store_name like 'private.embryo_canonical%'),
  array['variant-rows:private.embryo_canonical_source_parts','variant-rows:private.embryo_canonical_sources',
    'variant-rows:private.embryo_canonical_parts'],
  'the three stores are in the purge inventory with the other canonical-source stores, membership first');
select is((select polroles::regrole[]::text from pg_policy where polrelid='public.genome_files'::regclass
  and polname='genome_files_select_own'),'{authenticated}','the owner file policy applies to signed-in users only');

-- ---------------------------------------------------------------------------
-- Reserving a part under the live claim
-- ---------------------------------------------------------------------------
create temporary table claim1 as select public.claim_embryo_split_job_v1(pg_temp.token('a'),'synthetic-worker') as body;
select is((select (body->>'attempt')::integer from claim1),1,'attempt one is claimed');
select throws_ok($$select pg_temp.reserve(0,0,'z')$$,'42501','split claim unavailable','another token reserves nothing');
select throws_ok($$select pg_temp.reserve(0,7)$$,'22023','invalid canonical part','a fragment outside the manifest has no part');
select throws_ok($$select pg_temp.probe('update private.embryo_ingest_object_config set r2_bucket=null',
    'select pg_temp.reserve(0,0)::text')$$,'55000','embryo canonical storage unavailable',
  'without a configured R2 bucket nothing is reserved');
select is(pg_temp.probe($$alter table private.embryo_ingest_write_intents disable trigger embryo_ingest_write_intent_identity;
    update private.embryo_ingest_write_intents set state='open',storage_object_id=null,storage_version=null,landed_at=null
      where session_id=(select id from live) and sequence=1 and sample_ordinal=2;
    alter table private.embryo_ingest_write_intents enable trigger embryo_ingest_write_intent_identity$$,
  $$select pg_temp.reserve(2,1)->>'failureCode'$$,
  $$select count(*)::text from private.embryo_canonical_parts where session_id=(select id from live)$$),
  'chunk / 0','a fragment whose landing record is gone gets no part, and the attempt ends');

create temporary table t00 as select pg_temp.reserve(0,0) as body;
select is((select array_agg(k order by k) from t00, jsonb_object_keys(body) k),
  array['backend','bucket','byteCount','objectKey','ordinal','sequence','sessionId','sha256','version','writeExpiresAt'],
  'the receipt has exactly the fragment store''s R2 target shape');
select ok((select body->>'version'='embryo-ingest-write-target-v1' and body->>'backend'='r2'
    and body->>'bucket'='inherit-embryo-synthetic'
    and body->>'objectKey' ~ '^embryo/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (body->>'sessionId')::uuid=(select id from live) and (body->>'sequence')::integer=0
    and (body->>'ordinal')::integer=0 from t00),
  'a fresh opaque key in the configured bucket, for exactly this fragment');
select ok((select (t.body->>'byteCount')::integer=f.byte_count and t.body->>'sha256'=f.content_sha256
  from t00 t join public.embryo_ingest_fragments f on f.session_id=(select id from live)
    and f.sequence=0 and f.sample_ordinal=0),'the part must be byte-identical to its fragment');
select ok((select (body->>'writeExpiresAt')::timestamptz<=w.claim_expires_at
    and (body->>'writeExpiresAt')::timestamptz<=clock_timestamp()+interval '60 seconds'
  from t00, public.worker_jobs w where w.id=(select id from job)),
  'the write window outlives neither the claim nor sixty seconds');
select ok((select body->>'objectKey' not in (select provider_key from private.embryo_ingest_write_intents) from t00),
  'the key is no fragment''s key');
select throws_ok($$select pg_temp.reserve(0,0)$$,'22023','invalid canonical part','one part per fragment per attempt');
select is((pg_temp.part((select body from t00))).state,'open','a reserved part is open until it is acknowledged');

-- ---------------------------------------------------------------------------
-- Landing it with what the transport read back
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.ack((select body from t00),'z')$$,'42501','split claim unavailable',
  'another token lands nothing');
select throws_ok($$select pg_temp.ack((select body from t00),'a',1,'not-a-version')$$,'22023','invalid canonical part',
  'a provider version has a closed shape');
select throws_ok($$select pg_temp.ack(jsonb_set((select body from t00),'{byteCount}','1'))$$,'42501',
  'canonical part unavailable','a receipt other than the one issued is refused');
select throws_ok($$select pg_temp.ack((select body from t00),'a',1,null,null,repeat('e',64))$$,'42501',
  'canonical part unavailable','bytes that read back with another digest do not land');
select throws_ok($$select pg_temp.ack((select body from t00),'a',1,null,null,null,1)$$,'42501',
  'canonical part unavailable','bytes that read back at another size do not land');
select throws_ok($$select pg_temp.probe('alter table private.embryo_canonical_parts disable trigger embryo_canonical_part_immutable;
    update private.embryo_canonical_parts set created_at=clock_timestamp()-interval ''2 minutes'',
      write_expires_at=clock_timestamp()-interval ''1 minute'' where provider_key=(select body->>''objectKey'' from t00);
    alter table private.embryo_canonical_parts enable trigger embryo_canonical_part_immutable',
  'select pg_temp.ack(private.embryo_canonical_part_target_v1(pg_temp.part((select body from t00))))::text')$$,
  '42501','canonical part unavailable','a part whose write window closed does not land, even with its current receipt');

create temporary table a00 as select pg_temp.ack((select body from t00)) as body;
select is((select body from a00),jsonb_build_object('receipt',(select body from t00),
    'providerVersion',md5('version:'||(select body->>'objectKey' from t00)),
    'etag',md5('etag:'||(select body->>'objectKey' from t00))),
  'the ACK answers with the exact receipt and the identity it landed');
select ok((select state='landed' and observed_sha256=sha256 and landed_at<write_expires_at
  from pg_temp.part((select body from t00))),'the part is landed with its observed digest, inside its window');
select is(pg_temp.ack((select body from t00)),(select body from a00),'an exact replay answers the same');
select throws_ok($$select pg_temp.ack((select body from t00),'a',1,md5('another'))$$,'42501',
  'canonical part unavailable','a replay naming another provider version is refused');
select throws_ok($$update private.embryo_canonical_parts set provider_key='embryo/'||gen_random_uuid()
    where provider_key=(select body->>'objectKey' from t00)$$,'55000','embryo canonical part immutable',
  'a landed part never changes');

-- ---------------------------------------------------------------------------
-- A pass is recorded only with its whole canonical source landed
-- ---------------------------------------------------------------------------
select is(pg_temp.stage(0,0,pg_temp.rows())->>'rows','3','embryo 1 stages its calls');
select throws_ok($$select pg_temp.finish(0,pg_temp.passed(3))$$,'55000','canonical source unlanded',
  'a pass holding one of its two parts is not recorded');
create temporary table t01 as select pg_temp.reserve(0,1) as body;
select throws_ok($$select pg_temp.finish(0,pg_temp.passed(3))$$,'55000','canonical source unlanded',
  'a pass whose last part is reserved but not landed is not recorded');
select is(pg_temp.ack((select body from t01))->>'etag',md5('etag:'||(select body->>'objectKey' from t01)),
  'its second part lands');
select is(pg_temp.finish(0,pg_temp.passed(3))->>'outcome','passed','with every part landed the pass is recorded');
select throws_ok($$select pg_temp.reserve(0,0)$$,'22023','invalid canonical part','a recorded embryo takes no more parts');
select throws_ok($$select pg_temp.probe('select pg_temp.reserve(1,0)','select pg_temp.finish(1,pg_temp.failed())::text')$$,
  '55000','canonical source for a failed embryo','an embryo holding a canonical part cannot be recorded as failed');
select is(pg_temp.finish(1,pg_temp.failed())->>'outcome','qc_fail_no_source','embryo 2 fails QC with no part');
select is((select count(*) from private.embryo_canonical_parts where session_id=(select id from live) and sample_ordinal=1),
  0::bigint,'no object was ever reserved for the embryo that failed');

select is((select count(*) from public.genome_files f join public.subjects x on x.id=f.subject_id
  where x.cohort_id=(select cohort_id from live))
  +(select count(*) from public.genome_files where cohort_id=(select cohort_id from live)),0::bigint,
  'no embryo or cohort file row exists before publication');
select is((select count(*) from private.embryo_canonical_sources where cohort_id=(select cohort_id from live)),0::bigint,
  'no canonical source exists before publication');

-- ---------------------------------------------------------------------------
-- A retry reserves new keys; the old attempt's parts stay registered
-- ---------------------------------------------------------------------------
select is(pg_temp.fail('transient')->>'status','queued','a transient failure requeues the job');
update public.worker_jobs set not_before=clock_timestamp() where id=(select id from job);
create temporary table claim2 as select public.claim_embryo_split_job_v1(pg_temp.token('b'),'synthetic-worker') as body;
select is((select (body->>'attempt')::integer from claim2),2,'the retry is attempt two');
select is((select count(*) from private.embryo_canonical_parts where worker_job_id=(select id from job)
  and attempt=1 and state='landed'),2::bigint,'attempt one''s landed parts stay registered: their objects may exist');
select throws_ok($$select pg_temp.ack((select body from t01),'a',1)$$,'42501','split claim unavailable',
  'a superseded attempt lands nothing');
select is(pg_temp.stage(0,0,pg_temp.rows(),'b',2)->>'rows','3','attempt two stages embryo 1 again');
select is(pg_temp.land_parts(0,pg_temp.token('b'),2),2,'attempt two lands embryo 1''s two parts');
select is((select count(distinct provider_key) from private.embryo_canonical_parts
  where worker_job_id=(select id from job) and sample_ordinal=0),4::bigint,'no key is reused across attempts');
select is(pg_temp.finish(0,pg_temp.passed(3),'b',2)->>'outcome','passed','embryo 1 passes');
select is(pg_temp.finish(1,pg_temp.failed(),'b',2)->>'outcome','qc_fail_no_source','embryo 2 fails QC');
select is(pg_temp.stage(2,0,'[[22,9000,"C","T","C/T"],[13,4000,"A","G","G/G"]]','b',2)->>'rows','2',
  'embryo 3 stages its own calls');
select is(pg_temp.land_parts(2,pg_temp.token('b'),2),2,'embryo 3 lands its two parts');
select is(pg_temp.finish(2,pg_temp.passed(2),'b',2)->>'remaining','0','every embryo has an outcome');

-- The terminal transaction rechecks the parts and writes nothing when they
-- disagree with the outcomes.
select throws_ok($$select pg_temp.probe('delete from private.embryo_canonical_parts where worker_job_id=(select id from job)
    and attempt=2 and sample_ordinal=2 and sequence=1','select pg_temp.publish(''b'',2)::text')$$,
  '55000','split pending state inconsistent','a pass missing a canonical part does not publish');
select throws_ok($$select pg_temp.probe('insert into private.embryo_canonical_parts(session_id,worker_job_id,attempt,
    sample_ordinal,sequence,provider_bucket,provider_key,byte_count,sha256,created_at,write_expires_at)
    select (select id from live),(select id from job),2,1,0,''inherit-embryo-synthetic'',''embryo/''||gen_random_uuid(),
      f.byte_count,f.content_sha256,clock_timestamp(),clock_timestamp()+interval ''1 minute''
    from public.embryo_ingest_fragments f where f.session_id=(select id from live) and f.sequence=0 and f.sample_ordinal=1',
  'select pg_temp.publish(''b'',2)::text')$$,'55000','split pending state inconsistent',
  'a canonical part for the embryo that failed QC stops publication');

-- ---------------------------------------------------------------------------
-- Publication
-- ---------------------------------------------------------------------------
create temporary table digests as select o.sample_ordinal,o.source_sha256 from private.embryo_split_ordinals o
  where o.session_id=(select id from live);
create temporary table stats_before as select coalesce(sum(n),0) n from public.processing_time_stats();
create temporary table files_before as select count(*) n from public.genome_files;
create temporary table published as select pg_temp.publish('b',2) as body;
select is((select body from published),'{"status":"published","publicationRevision":1,"published":2,"qcFailed":1}'::jsonb,
  'the cohort publishes two sources and one QC failure');

create temporary table files as select e.sample_ordinal,f.* from public.genome_files f
  join public.embryos e on e.subject_id=f.subject_id where e.cohort_id=(select cohort_id from live);
select is((select array_agg(sample_ordinal order by sample_ordinal) from files),array[0,2]::smallint[],
  'exactly one file row for each passing embryo, and none for the failure');
select is((select count(*) from public.genome_files)-(select n from files_before),2::bigint,
  'publication adds no other file row, and no cohort row');
select ok((select bool_and(f.source_sha256=d.source_sha256 and f.source_binding_fingerprint=d.source_sha256)
  from files f join digests d using (sample_ordinal)),'each file is bound to its own embryo''s digest');
select isnt((select source_sha256 from files where sample_ordinal=0),(select source_sha256 from files where sample_ordinal=2),
  'two embryos never share a digest');
select ok((select bool_and(f.user_id=c.owner_account_id and f.cohort_id is null and not f.is_cohort_file
    and f.sample_count=1 and f.file_type='vcf' and f.tier=1 and f.status='stored' and f.build='GRCh38'
    and f.canonical_build='GRCh38' and f.original_name='embryo-autosomal-source.vcf'
    and f.bucket_path='embryo-source/'||f.id and f.sha256 is null and f.storage_object_id is null
    and f.structural_validator_version='embryo-ordinal-fragment-v1' and f.source_publication_state='published'
    and f.source_publication_revision=c.publication_revision and f.error is null)
  from files f, public.embryo_cohorts c where c.id=(select cohort_id from live)),
  'each row is the owner''s single-embryo source, with a neutral name and no raw object');
select ok((select bool_and(f.normalization_completed_at=c.uploaded_at and f.single_logical_sample_verified_at=c.uploaded_at
    and f.processing_finished_at=c.uploaded_at and f.processing_started_at is null
    and f.normalization_source_revision=f.upload_revision and f.upload_revision=1)
  from files f, public.embryo_cohorts c where c.id=(select cohort_id from live)),
  'each source is normalization_complete at the publication commit, for its own revision');
select is((select array_agg(format('%s:%s:%s',sample_ordinal,variant_count,size_bytes) order by sample_ordinal) from files),
  array['0:3:160','2:2:164'],'each row counts its own genotypes and its own fragment bytes');

select is((select array_agg(format('%s:%s:%s:%s:%s',s.sample_ordinal,s.part_count,s.byte_count,s.variant_count,s.attempt)
    order by s.sample_ordinal) from private.embryo_canonical_sources s where s.cohort_id=(select cohort_id from live)),
  array['0:2:160:3:2','2:2:164:2:2'],'one canonical source per passing embryo, from the publishing attempt');
select ok((select bool_and(s.file_id=f.id and s.embryo_id=e.id and s.subject_id=e.subject_id
    and s.source_sha256=f.source_sha256 and s.published_at=f.normalization_completed_at and s.publication_revision=1
    and s.reference_build='GRCh38')
  from private.embryo_canonical_sources s join files f on f.sample_ordinal=s.sample_ordinal
  join public.embryos e on e.cohort_id=s.cohort_id and e.sample_ordinal=s.sample_ordinal
  where s.cohort_id=(select cohort_id from live)),'each source names its own file, embryo and subject');
select is((select array_agg(format('%s:%s:%s:%s',s.sample_ordinal,m.sequence,p.sample_ordinal,p.attempt)
    order by s.sample_ordinal,m.sequence)
  from private.embryo_canonical_source_parts m join private.embryo_canonical_sources s on s.file_id=m.file_id
  join private.embryo_canonical_parts p on p.id=m.part_id
  where s.cohort_id=(select cohort_id from live) and p.state='landed' and p.sequence=m.sequence),
  array['0:0:0:2','0:1:0:2','2:0:2:2','2:1:2:2'],
  'each source binds exactly its own landed parts of the publishing attempt, in order');
select ok((select bool_and(private.embryo_canonical_source_sha256_v1(s.file_id)=s.source_sha256
    and s.source_sha256=private.embryo_split_source_sha256_v1(s.session_id,s.sample_ordinal)
    and private.embryo_canonical_membership_sha256_v1(array(select m.part_id from private.embryo_canonical_source_parts m
      where m.file_id=s.file_id))=s.membership_sha256)
  from private.embryo_canonical_sources s where s.cohort_id=(select cohort_id from live)),
  'the source digest recomputes from its parts and equals its fragments'' digest; the membership digest reproduces');
select is((select count(*) from private.embryo_canonical_parts p where p.worker_job_id=(select id from job)
  and p.attempt=1 and not exists (select 1 from private.embryo_canonical_source_parts m where m.part_id=p.id)),2::bigint,
  'attempt one''s parts are bound to nothing and stay registered for cleanup');

select ok((select bool_and(v.source_file_id=f.id) from public.embryo_variants v join public.embryos e on e.id=v.embryo_id
    join files f on f.subject_id=e.subject_id where e.cohort_id=(select cohort_id from live))
  and (select count(*) from public.embryo_variants v join public.embryos e on e.id=v.embryo_id
    where e.cohort_id=(select cohort_id from live))=5,
  'every published genotype points at its own embryo''s file');
select is((select array_agg(format('%s:%s',f.sample_ordinal,(select count(*) from public.embryo_variants v
    where v.source_file_id=f.id)) order by f.sample_ordinal) from files f),array['0:3','2:2'],
  'each file holds exactly its own embryo''s rows');
select is((select coalesce(sum(n),0) from public.processing_time_stats()),(select n from stats_before),
  'embryo sources never enter the self processing-time figures');

select throws_ok($$update private.embryo_canonical_sources set variant_count=variant_count+1
    where cohort_id=(select cohort_id from live)$$,'55000','embryo canonical source immutable',
  'a published canonical source never changes');
select throws_ok($$update private.embryo_canonical_source_parts set sequence=sequence
    where file_id in (select file_id from private.embryo_canonical_sources where cohort_id=(select cohort_id from live))$$,
  '55000','embryo canonical source immutable','its membership never changes');
select throws_ok($$delete from private.embryo_canonical_parts where id in (select part_id from private.embryo_canonical_source_parts)$$,
  '23503',null,'a bound part cannot be deleted while its source exists');
select throws_ok($$update public.genome_files set source_sha256=repeat('0',64) where id=(select id from files where sample_ordinal=0)$$,
  '55000','immutable_file_identity','the file''s identity and digest never change');
select throws_ok($$select pg_temp.reserve(2,0,'b',2)$$,'42501','split claim unavailable','no part is reserved after publication');

-- ---------------------------------------------------------------------------
-- The owner's generic file read never returns an embryo source
-- ---------------------------------------------------------------------------
insert into public.genome_files(user_id,bucket_path,original_name,file_type,tier,size_bytes,status,subject_id)
  select '7a000000-0000-0000-0000-000000000001',gen_random_uuid()::text,'synthetic-self.txt','array_23andme',1,100,'stored',
    (select id from public.subjects where owner_account_id='7a000000-0000-0000-0000-000000000001' and subject_class='self');
select id as self_file_id from public.genome_files where original_name='synthetic-self.txt'
  and user_id='7a000000-0000-0000-0000-000000000001' \gset
select id as embryo_file_id from files where sample_ordinal=0 \gset
select set_config('request.jwt.claims','{"sub":"7a000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select array_agg(id::text) from public.genome_files),array[:'self_file_id'],
  'the owner''s own file list shows the self file and no embryo source');
select is((select count(*) from public.genome_files where id=:'embryo_file_id'),0::bigint,
  'an embryo source cannot be read even by its id');
select is(private.genome_file_owner_listable_v1(:'embryo_file_id'),false,'the helper refuses the embryo source');
select is(private.genome_file_owner_listable_v1(:'self_file_id'),true,'the helper admits the owner''s own self file');
reset role;
set local role anon;
select is((select count(*) from public.genome_files),0::bigint,'an anonymous read sees no file');
reset role;
select set_config('request.jwt.claims','{"sub":"7a000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is(private.genome_file_owner_listable_v1(:'self_file_id'),false,'the helper answers nothing about another account''s file');
select is((select count(*) from public.genome_files),0::bigint,'another account sees none of the owner''s files');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

select * from finish();
rollback;
