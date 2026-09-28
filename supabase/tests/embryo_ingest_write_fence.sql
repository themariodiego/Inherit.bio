begin;
select no_plan();
-- ADR 0020 safeguard 1: the embryo-ingest Storage write fence and drain.
-- Every session below is a synthetic signed two-parent attempt. Object rows are
-- metadata written the way Storage writes them; no provider bytes exist here.
\ir fixtures/embryo_ingest_attempt.inc

create function pg_temp.fragments() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('ordinal',0,'sha256',repeat('b',64),'bytes',80,'lines',4),
    jsonb_build_object('ordinal',1,'sha256',repeat('c',64),'bytes',80,'lines',4));
$$;
create temporary table attempts(label text primary key, id uuid not null);
grant select on attempts to service_role;
create function pg_temp.sid(p_label text) returns uuid language sql as $$
  select id from attempts where label=p_label;
$$;
create function pg_temp.reserve(p_label text, p_sequence integer default 0, p_fragments jsonb default null)
returns text language sql as $$
  select private.reserve_embryo_ingest_chunk_v1(pg_temp.sid(p_label),p_sequence,repeat('d',64),100,2,60,
    coalesce(p_fragments,pg_temp.fragments()))->>'status';
$$;
create function pg_temp.commit(p_label text, p_sequence integer default 0) returns text language sql as $$
  select private.commit_embryo_ingest_chunk_v1(pg_temp.sid(p_label),p_sequence,repeat('d',64))->>'status';
$$;
create function pg_temp.name_of(p_label text, p_ordinal integer, p_sequence integer default 0)
returns text language sql as $$
  select object_name from public.embryo_ingest_fragments
    where session_id=pg_temp.sid(p_label) and sequence=p_sequence and sample_ordinal=p_ordinal;
$$;
create function pg_temp.intent(p_label text, p_ordinal integer, p_sequence integer default 0)
returns private.embryo_ingest_write_intents language sql as $$
  select * from private.embryo_ingest_write_intents
    where session_id=pg_temp.sid(p_label) and sequence=p_sequence and sample_ordinal=p_ordinal;
$$;
create function pg_temp.fence(p_label text) returns private.embryo_ingest_write_fences language sql as $$
  select * from private.embryo_ingest_write_fences where session_id=pg_temp.sid(p_label);
$$;
-- Storage's final write shape: a UUID-v4 version and metadata.size.
create function pg_temp.put(p_name text, p_size jsonb default '80', p_version text default null)
returns void language sql as $$
  insert into storage.objects(bucket_id,name,version,metadata)
  values('genomes',p_name,coalesce(p_version,gen_random_uuid()::text),jsonb_build_object('size',p_size));
$$;
-- Storage's create-only permission probe: version '1' with contentLength,
-- which the provider rolls back. PT001 plays that rollback. With p_commit the
-- deferred constraint is forced to run as it would at COMMIT.
create function pg_temp.probe(p_name text, p_bytes integer default 80, p_commit boolean default false)
returns text language plpgsql as $$
declare admitted boolean:=false;
begin
  begin
    insert into storage.objects(bucket_id,name,version,metadata)
      values('genomes',p_name,'1',jsonb_build_object('mimetype','text/plain','contentLength',p_bytes));
    admitted:=true;
    if p_commit then
      set constraints storage.refuse_committed_embryo_ingest_probe immediate;
      return 'unexpectedly_committable';
    end if;
    raise exception using errcode='PT001',message='rollback_provider_permission_probe';
  exception when sqlstate 'PT001' then
    return case when admitted then 'admitted_then_rolled_back' else 'not_admitted' end;
  when insufficient_privilege then return sqlerrm;
  end;
end;
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"service_role"}',true);
$$;

-- ---------------------------------------------------------------------------
-- Catalogue, grants and purge registration
-- ---------------------------------------------------------------------------
select ok((select bool_and(relrowsecurity) from pg_class where oid in
  ('private.embryo_ingest_write_intents'::regclass,'private.embryo_ingest_write_fences'::regclass)),
  'intents and fences have row-level security');
select ok(not has_table_privilege(r,t,p), format('%s holds no %s on %s',r,p,t))
  from unnest(array['anon','authenticated','service_role','inherit_upload_only']) r,
    unnest(array['private.embryo_ingest_write_intents','private.embryo_ingest_write_fences']) t,
    unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p;
select ok(has_function_privilege('service_role','public.embryo_ingest_write_targets_v1(uuid,integer)','EXECUTE')
  and has_function_privilege('service_role','public.settle_embryo_ingest_writes_v1(uuid)','EXECUTE'),
  'the service role can call both doors');
select ok(not has_function_privilege(r,f,'EXECUTE'), format('%s cannot call %s',r,f))
  from unnest(array['anon','authenticated','inherit_upload_only']) r,
    unnest(array['public.embryo_ingest_write_targets_v1(uuid,integer)','public.settle_embryo_ingest_writes_v1(uuid)',
      'private.embryo_ingest_write_targets_v1(uuid,integer)','private.settle_embryo_ingest_writes_v1(uuid)']) f;
select ok(not has_function_privilege(r,f,'EXECUTE'), format('%s cannot call internal %s',r,f))
  from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r,
    unnest(array['private.embryo_ingest_object_name_v1(text,text)','private.freeze_embryo_ingest_write_record_v1()',
      'private.issue_embryo_ingest_write_intent_v1()','private.stamp_embryo_ingest_write_fence_v1(uuid)',
      'private.fence_embryo_ingest_writes_v1()','private.guard_embryo_ingest_object_v1()',
      'private.refuse_committed_embryo_ingest_probe_v1()','private.gate_embryo_ingest_chunk_objects_v1()']) f;
select ok((select not prosecdef from pg_proc where oid='public.embryo_ingest_write_targets_v1(uuid,integer)'::regprocedure)
  and (select not prosecdef from pg_proc where oid='public.settle_embryo_ingest_writes_v1(uuid)'::regprocedure)
  and (select bool_and(prosecdef) from pg_proc where oid in ('private.embryo_ingest_write_targets_v1(uuid,integer)'::regprocedure,
    'private.settle_embryo_ingest_writes_v1(uuid)'::regprocedure,'private.guard_embryo_ingest_object_v1()'::regprocedure)),
  'public doors are invokers over private definers');
select is((select array_agg(store_name order by store_order) from public.purge_target_stores
  where target_id='upload-and-ingest-working-state' and store_name like 'private.embryo_ingest_write_%'),
  array['private.embryo_ingest_write_intents','private.embryo_ingest_write_fences'],
  'intents and fences are registered with the ingest working-state purge target');
select ok((select min(store_order) from public.purge_target_stores where store_name like 'private.embryo_ingest_write_%')
  > (select max(store_order) from public.purge_target_stores where target_id='upload-and-ingest-working-state'
    and store_name not like 'private.embryo_ingest_write_%'),
  'the new stores take the next store orders after every existing ingest store');
select ok(exists(select 1 from pg_trigger where tgrelid='storage.objects'::regclass
  and tgname='guard_embryo_ingest_object' and tgtype&2=2 and tgtype&4=4 and tgtype&16=16),
  'the metadata guard fires before every INSERT and UPDATE on storage.objects');
select ok((select condeferrable and condeferred from pg_constraint
  where conrelid='storage.objects'::regclass and conname='refuse_committed_embryo_ingest_probe'),
  'the probe constraint is deferred so the provider rollback admission can run');
select ok((select position('for share' in prosrc)>0
  and position('for share' in prosrc)<position('embryo_ingest_binding_failure_v1' in prosrc)
  and position('embryo_ingest_binding_failure_v1' in prosrc)<position('for update' in prosrc)
  from pg_proc where oid='private.guard_embryo_ingest_object_v1()'::regprocedure),
  'guard locks the session, then checks authority, then locks the intent (static order, not a race test)');
select ok(private.embryo_ingest_object_name_v1('genomes',
  '7a000000-0000-4000-8000-000000000001/7a000000-0000-4000-8000-000000000002/7a000000-0000-4000-8000-000000000003/7a000000-0000-4000-8000-000000000004.vcf'),
  'a lowercase four-UUID VCF name is in the fenced namespace');
select ok(private.embryo_ingest_object_name_v1('genomes',
  '7A000000-0000-4000-8000-00000000000A/7a000000-0000-4000-8000-000000000002/7a000000-0000-4000-8000-000000000003/7a000000-0000-4000-8000-000000000004.TSV'),
  'case variants are in the fenced namespace too');
select ok(not private.embryo_ingest_object_name_v1('genomes',
  '7a000000-0000-4000-8000-000000000002/7a000000-0000-4000-8000-000000000003/7a000000-0000-4000-8000-000000000004.vcf')
  and not private.embryo_ingest_object_name_v1('genomes',
  '7a000000-0000-4000-8000-000000000001/7a000000-0000-4000-8000-000000000002/7a000000-0000-4000-8000-000000000003/7a000000-0000-4000-8000-000000000004.vcf.gz')
  and not private.embryo_ingest_object_name_v1('genomes-staging',
  '7a000000-0000-4000-8000-000000000001/7a000000-0000-4000-8000-000000000002/7a000000-0000-4000-8000-000000000003/7a000000-0000-4000-8000-000000000004.vcf')
  and not private.embryo_ingest_object_name_v1(null,null),
  'three segments, other suffixes, other buckets and nulls are outside the namespace');

-- ---------------------------------------------------------------------------
-- Intents are issued with the reservation
-- ---------------------------------------------------------------------------
insert into attempts values('a',pg_temp.new_attempt());
select is(pg_temp.reserve('a'),'reserved','the primary attempt reserves two fragments');
select is((select count(*) from private.embryo_ingest_write_intents where session_id=pg_temp.sid('a')),2::bigint,
  'one intent per reserved fragment');
select ok((select bool_and(i.state='open' and i.write_attempts=1 and i.byte_count=f.byte_count
    and i.object_name=f.object_name and i.storage_object_id is null and i.landed_at is null and i.settled_at is null)
  from private.embryo_ingest_write_intents i join public.embryo_ingest_fragments f using (session_id,sequence,sample_ordinal)
  where i.session_id=pg_temp.sid('a')),
  'each intent names its fragment''s exact object and byte count, open, first window');
select ok((select bool_and(i.write_expires_at>i.created_at and i.write_expires_at<=i.created_at+interval '60 seconds'
    and i.write_expires_at<=s.expires_at)
  from private.embryo_ingest_write_intents i join public.embryo_ingest_sessions s on s.id=i.session_id
  where i.session_id=pg_temp.sid('a')),
  'each window is at most sixty seconds and never past the session deadline');
create temporary table first_windows as select sample_ordinal,write_expires_at from private.embryo_ingest_write_intents
  where session_id=pg_temp.sid('a');
select is(pg_temp.reserve('a'),'reserved','an identical reservation retry resumes');
select is((select count(*) from private.embryo_ingest_write_intents i join first_windows w using (sample_ordinal)
  where i.session_id=pg_temp.sid('a') and i.write_expires_at=w.write_expires_at and i.write_attempts=1),2::bigint,
  'a reservation retry issues no intent and renews no window');
select is((public.embryo_ingest_write_targets_v1(pg_temp.sid('a'),0)->'targets'),
  (select jsonb_agg(jsonb_build_object('ordinal',sample_ordinal,'objectName',object_name,'state','open',
    'writeExpiresAt',write_expires_at) order by sample_ordinal)
   from private.embryo_ingest_write_intents where session_id=pg_temp.sid('a')),
  'targets name each ordinal''s object, state and window');
select is(public.embryo_ingest_write_targets_v1(pg_temp.sid('a'),0)->>'status','reserved',
  'targets report the chunk state');
select is(public.embryo_ingest_write_targets_v1(pg_temp.sid('a'),7),'{"status":"denied"}'::jsonb,
  'an unreserved sequence has no targets');
select is(public.embryo_ingest_write_targets_v1(gen_random_uuid(),0),'{"status":"denied"}'::jsonb,
  'an unknown session has no targets');

-- ---------------------------------------------------------------------------
-- The Storage metadata guard: callers, names and shapes
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select pg_temp.put(pg_temp.name_of('a',0))$$,'42501','embryo_object_unavailable',
  'a connection carrying an authenticated JWT cannot create embryo metadata');
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok($$select pg_temp.put(pg_temp.name_of('a',0))$$,'42501','embryo_object_unavailable',
  'an anon JWT cannot create embryo metadata');
select set_config('request.jwt.claims','{"role":"inherit_upload_only"}',true);
select throws_ok($$select pg_temp.put(pg_temp.name_of('a',0))$$,'42501','embryo_object_unavailable',
  'the upload-token role cannot create embryo metadata');
select set_config('request.jwt.claims','',true);
select throws_ok($$select pg_temp.put(pg_temp.name_of('a',0))$$,'42501','embryo_object_unavailable',
  'a connection with no JWT cannot create embryo metadata');
-- The name is resolved as the owner, so the authenticated role needs no read.
create temporary table exact_name as select pg_temp.name_of('a',0) n;
grant select on exact_name to authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$insert into storage.objects(bucket_id,name,version,metadata)
  values('genomes',(select n from exact_name),gen_random_uuid()::text,'{"size":80}')$$,'42501','embryo_object_unavailable',
  'an authenticated role writing the exact reserved name reaches the guard and is refused');
reset role;

select pg_temp.as_service();
set local role service_role;
select throws_ok($$select pg_temp.put(gen_random_uuid()||'/'||gen_random_uuid()||'/'||gen_random_uuid()||'/'||gen_random_uuid()||'.vcf')$$,
  '42501','embryo_object_unavailable','an unreserved name in the namespace is refused');
select throws_ok($$select pg_temp.put(upper(pg_temp.name_of('a',0)))$$,'42501','embryo_object_unavailable',
  'an uppercase variant of a reserved name is refused, not written beside it');
select throws_ok($$select pg_temp.put(pg_temp.name_of('a',0),'81')$$,'42501','embryo_object_unavailable',
  'a size other than the reserved byte count is refused');
select throws_ok($$select pg_temp.put(pg_temp.name_of('a',0),'"80"')$$,'42501','embryo_object_unavailable',
  'a size that is not a JSON number is refused');
select throws_ok($$select pg_temp.put(pg_temp.name_of('a',0),'0')$$,'42501','embryo_object_unavailable',
  'a zero size is refused');
select throws_ok($$insert into storage.objects(bucket_id,name,version,metadata)
  values('genomes',pg_temp.name_of('a',0),gen_random_uuid()::text,'{"contentLength":80}')$$,
  '42501','embryo_object_unavailable','a final-shaped write without metadata.size is refused');
select throws_ok($$select pg_temp.put(pg_temp.name_of('a',0),'80','v2')$$,'42501','embryo_object_unavailable',
  'a version that is neither the probe nor a UUID-v4 is refused');
select throws_ok($$select pg_temp.put(pg_temp.name_of('a',0),'80','7a000000-0000-1000-8000-000000000001')$$,
  '42501','embryo_object_unavailable','a non-v4 UUID version is refused');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata)
  values('genomes',pg_temp.name_of('a',0),'{"size":80}')$$,'42501','embryo_object_unavailable',
  'a write with no version is refused');
select throws_ok($$select pg_temp.put(pg_temp.name_of('a',0),'80','1')$$,'42501','embryo_object_unavailable',
  'a probe-versioned write carrying size instead of contentLength is refused');
select is(pg_temp.probe(pg_temp.name_of('a',0),81),'embryo_object_unavailable',
  'a permission probe with the wrong contentLength is refused');
select is(pg_temp.probe(pg_temp.name_of('a',0)),'admitted_then_rolled_back',
  'Storage''s rollback-only permission probe is admitted under an open intent');
reset role;
select is((pg_temp.intent('a',0)).state,'open','an admitted probe does not land the intent');
set local role service_role;
select is(pg_temp.probe(pg_temp.name_of('a',0),80,true),'embryo_probe_uncommittable',
  'the deferred constraint refuses to commit a probe-shaped row');
reset role;
set constraints storage.refuse_committed_embryo_ingest_probe deferred;
select ok(not exists(select 1 from storage.objects where bucket_id='genomes' and name=pg_temp.name_of('a',0)),
  'neither probe left metadata behind');
set local role service_role;
select lives_ok($$select pg_temp.put(gen_random_uuid()||'/'||gen_random_uuid()||'/'||gen_random_uuid()||'.vcf')$$,
  'a service write outside the namespace is not the guard''s business');
reset role;
select set_config('request.jwt.claims','',true);

-- ---------------------------------------------------------------------------
-- Landing, the commit gate and UPDATE refusal
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.commit('a')$$,'55000','embryo_chunk_objects_unlanded',
  'no object landed: the chunk cannot commit');
select pg_temp.as_service();
set local role service_role;
select lives_ok($$select pg_temp.put(pg_temp.name_of('a',0))$$,'the exact service write lands');
reset role;
select ok((select i.state='landed' and i.storage_object_id=o.id and i.storage_version=o.version
    and i.landed_at is not null and i.landed_at<i.write_expires_at
  from storage.objects o, pg_temp.intent('a',0) i where o.bucket_id='genomes' and o.name=i.object_name),
  'the landing records the exact object id and version in the same transaction');
select throws_ok($$select pg_temp.commit('a')$$,'55000','embryo_chunk_objects_unlanded',
  'one of two objects landed: the chunk cannot commit');
set local role service_role;
select throws_ok($$select pg_temp.put(pg_temp.name_of('a',0))$$,'42501','embryo_object_unavailable',
  'a landed name cannot be written again');
select throws_ok($$insert into storage.objects(bucket_id,name,version,metadata)
  values('genomes',pg_temp.name_of('a',0),gen_random_uuid()::text,'{"size":80}')
  on conflict(bucket_id,name) do update set metadata=excluded.metadata$$,
  '42501','embryo_object_unavailable','an upsert cannot replace a landed object');
select throws_ok($$update storage.objects set metadata='{"size":80}'
  where bucket_id='genomes' and name=pg_temp.name_of('a',0)$$,'42501','embryo_object_unavailable',
  'even an identical UPDATE of an embryo object is refused');
select throws_ok($$update storage.objects set name=name||'.moved'
  where bucket_id='genomes' and name=pg_temp.name_of('a',0)$$,'42501','embryo_object_unavailable',
  'an UPDATE cannot move an embryo object out of the namespace');
insert into storage.objects(bucket_id,name,version,metadata)
  values('genomes','fence-test/'||gen_random_uuid()||'.txt',gen_random_uuid()::text,'{"size":80}');
select throws_ok($$update storage.objects set name=pg_temp.name_of('a',1)
  where bucket_id='genomes' and name like 'fence-test/%'$$,'42501','embryo_object_unavailable',
  'an UPDATE cannot move another object into a reserved embryo name');
select lives_ok($$update storage.objects set metadata='{"size":81}'
  where bucket_id='genomes' and name like 'fence-test/%'$$,
  'an UPDATE wholly outside the namespace is untouched');
reset role;

-- An expired window refuses; the targets door renews it once per attempt.
update private.embryo_ingest_write_intents set write_expires_at=clock_timestamp()+interval '50 milliseconds'
  where session_id=pg_temp.sid('a') and sample_ordinal=1;
select pg_sleep(0.075);
set local role service_role;
select throws_ok($$select pg_temp.put(pg_temp.name_of('a',1))$$,'42501','embryo_object_unavailable',
  'a write after its window closed is refused');
reset role;
select ok((select state='open' and write_attempts=1 and write_expires_at<=clock_timestamp() from pg_temp.intent('a',1)),
  'the refused write left the expired intent open');
select set_config('request.jwt.claims','',true);
create temporary table renewed as select public.embryo_ingest_write_targets_v1(pg_temp.sid('a'),0) body;
select ok((select i.write_attempts=2 and i.write_expires_at>clock_timestamp()
    and i.write_expires_at<=clock_timestamp()+interval '60 seconds' from pg_temp.intent('a',1) i),
  'targets renew an expired open window as the second attempt');
select ok((select write_attempts=1 and state='landed' from pg_temp.intent('a',0)),
  'a landed intent is never renewed');
select is((select body->'targets'->1->>'state' from renewed),'open','the renewed target is reported open');
select pg_temp.as_service();
set local role service_role;
select lives_ok($$select pg_temp.put(pg_temp.name_of('a',1))$$,'the renewed window admits the write');
reset role;
select set_config('request.jwt.claims','',true);
select is(pg_temp.commit('a'),'stored','with every object landed the chunk commits');
select is((select array_agg(value->>'state' order by (value->>'ordinal')::integer)
  from jsonb_array_elements(public.embryo_ingest_write_targets_v1(pg_temp.sid('a'),0)->'targets')),
  array['landed','landed'],'targets of a stored chunk report both objects landed');
select throws_ok($$update public.embryo_ingest_chunks set state='reserved',stored_at=null
  where session_id=pg_temp.sid('a') and sequence=0$$,'55000','embryo_chunk_objects_unlanded',
  'a stored chunk cannot return to reserved');
select throws_ok($$insert into public.embryo_ingest_fragments(session_id,sequence,sample_ordinal,object_id,content_sha256,byte_count,line_count)
  values(pg_temp.sid('a'),0,5,gen_random_uuid(),repeat('b',64),80,4)$$,'55000','embryo_write_intent_unavailable',
  'no intent is issued for a fragment added to a stored chunk');
select throws_ok($$insert into public.embryo_ingest_chunks(session_id,sequence,content_sha256,byte_count,record_count,maximum_line_bytes,state,stored_at)
  values(pg_temp.sid('a'),9,repeat('d',64),100,2,60,'stored',clock_timestamp())$$,'55000','embryo_chunk_objects_unlanded',
  'a chunk cannot be created already stored');
select is(pg_temp.reserve('a',1,'[]'),'reserved','a chunk without fragments reserves');
select is(pg_temp.commit('a',1),'stored','a chunk without fragments still commits');

-- A deleted object and a direct state write are refused alike.
insert into attempts values('b',pg_temp.new_attempt());
select is(pg_temp.reserve('b'),'reserved','the deletion attempt reserves');
select pg_temp.as_service();
set local role service_role;
select is(pg_temp.write_fragment_objects(pg_temp.sid('b'),0),2,'both objects land');
reset role;
select set_config('request.jwt.claims','',true);
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where bucket_id='genomes' and name=pg_temp.name_of('b',1);
select throws_ok($$select pg_temp.commit('b')$$,'55000','embryo_chunk_objects_unlanded',
  'a landed intent whose metadata row was deleted cannot commit');
select throws_ok($$update public.embryo_ingest_chunks set state='stored',stored_at=clock_timestamp()
  where session_id=pg_temp.sid('b') and sequence=0$$,'55000','embryo_chunk_objects_unlanded',
  'the gate is a trigger, so a direct state write is refused too');
select is((select state from public.embryo_ingest_chunks where session_id=pg_temp.sid('b')),'reserved',
  'the chunk stays reserved');

-- ---------------------------------------------------------------------------
-- Session authority and deletion inventory
-- ---------------------------------------------------------------------------
insert into attempts values('e',pg_temp.new_attempt());
select is(pg_temp.reserve('e'),'reserved','the revocation attempt reserves');
update public.profiles set auth_session_revision=auth_session_revision+1
  where id=(select account_id from public.embryo_ingest_sessions where id=pg_temp.sid('e'));
select pg_temp.as_service();
set local role service_role;
select throws_ok($$select pg_temp.put(pg_temp.name_of('e',0))$$,'42501','embryo_object_unavailable',
  'a revoked authenticated session cannot land an object');
reset role;
select set_config('request.jwt.claims','',true);
select ok((select state='open' from pg_temp.intent('e',0)),'the refusal persisted nothing');
select is(public.embryo_ingest_write_targets_v1(pg_temp.sid('e'),0),'{"status":"failure_pending"}'::jsonb,
  'the targets door records the revocation as the attempt failure');
select is((select failure_code from public.embryo_ingest_sessions where id=pg_temp.sid('e')),
  'authenticated-session-revocation','the failure is coded');
select ok((select f.fence_at=(select max(write_expires_at) from private.embryo_ingest_write_intents
    where session_id=pg_temp.sid('e')) and f.fence_at>f.fenced_at from pg_temp.fence('e') f),
  'leaving the writable set stamps the fence at the last open window');

insert into attempts values('f',pg_temp.new_attempt());
select is(pg_temp.reserve('f'),'reserved','the deletion-listed attempt reserves');
create temporary table synthetic_unwind as select gen_random_uuid() id;
insert into public.embryo_ingest_unwinds(id,cohort_id,ingest_revision,fixed_ingest_deadline)
  select id,gen_random_uuid(),1,clock_timestamp()+interval '1 hour' from synthetic_unwind;
insert into public.embryo_ingest_delete_objects(unwind_id,ordinal,bucket_id,object_name,source_kind,source_id)
  select (select id from synthetic_unwind),1,'genomes',pg_temp.name_of('f',0),'ingest-fragment',gen_random_uuid();
select pg_temp.as_service();
set local role service_role;
select throws_ok($$select pg_temp.put(pg_temp.name_of('f',0))$$,'42501','embryo_object_unavailable',
  'a name already in a deletion inventory cannot be written');
select lives_ok($$select pg_temp.put(pg_temp.name_of('f',1))$$,'an unlisted name of the same chunk still lands');
reset role;
select set_config('request.jwt.claims','',true);

insert into attempts values('g',pg_temp.new_attempt());
select is(pg_temp.reserve('g'),'reserved','the retry-exhaustion attempt reserves');
update private.embryo_ingest_write_intents set write_attempts=write_attempts+1,write_expires_at=write_expires_at+interval '1 second'
  where session_id=pg_temp.sid('g') and sample_ordinal=0;
update private.embryo_ingest_write_intents set write_attempts=write_attempts+1,write_expires_at=write_expires_at+interval '1 second'
  where session_id=pg_temp.sid('g') and sample_ordinal=0;
select throws_ok($$update private.embryo_ingest_write_intents set write_attempts=4,write_expires_at=write_expires_at+interval '1 second'
  where session_id=pg_temp.sid('g') and sample_ordinal=0$$,'23514',null,'no intent gets a fourth window');
select throws_ok($$update private.embryo_ingest_write_intents set write_attempts=write_attempts-1
  where session_id=pg_temp.sid('g') and sample_ordinal=0$$,'55000','immutable embryo write record',
  'attempts never decrease');
update private.embryo_ingest_write_intents set write_expires_at=clock_timestamp()+interval '50 milliseconds'
  where session_id=pg_temp.sid('g') and sample_ordinal=0;
select pg_sleep(0.075);
select is(public.embryo_ingest_write_targets_v1(pg_temp.sid('g'),0),'{"status":"failure_pending"}'::jsonb,
  'an expired third window cannot be renewed and fails the attempt');
select is((select failure_code from public.embryo_ingest_sessions where id=pg_temp.sid('g')),'retry-exhaustion',
  'the failure is coded as retry exhaustion');

-- ---------------------------------------------------------------------------
-- The fence and the drain
-- ---------------------------------------------------------------------------
insert into attempts values('c',pg_temp.new_attempt());
select is(pg_temp.reserve('c'),'reserved','the fence attempt reserves');
select is(public.settle_embryo_ingest_writes_v1(pg_temp.sid('c')),'{"status":"writable"}'::jsonb,
  'an open unexpired session is writable, not settled');
select ok(not exists(select 1 from private.embryo_ingest_write_fences where session_id=pg_temp.sid('c')),
  'asking to settle a writable session stamps nothing');
select pg_temp.as_service();
set local role service_role;
select lives_ok($$select pg_temp.put(pg_temp.name_of('c',0))$$,'one object lands before the failure');
reset role;
select set_config('request.jwt.claims','',true);
-- Two seconds keeps the fence time ahead of the next few statements on a slow
-- runner; the sleep below waits for exactly what remains of it.
update private.embryo_ingest_write_intents set write_expires_at=clock_timestamp()+interval '2 seconds'
  where session_id=pg_temp.sid('c') and sample_ordinal=1;
select private.mark_embryo_ingest_failure_v1(pg_temp.sid('c'),'abort');
select ok((select f.fence_at=(pg_temp.intent('c',1)).write_expires_at and f.fenced_at<f.fence_at
    and f.settled_at is null from pg_temp.fence('c') f),
  'the fence is stamped at failure, at the latest open window (the landed one does not count)');
select pg_temp.as_service();
set local role service_role;
select throws_ok($$select pg_temp.put(pg_temp.name_of('c',1))$$,'42501','embryo_object_unavailable',
  'a fenced session refuses a write even inside its window');
select is(pg_temp.probe(pg_temp.name_of('c',1)),'embryo_object_unavailable',
  'a fenced session refuses the permission probe too');
reset role;
select set_config('request.jwt.claims','',true);
select throws_ok($$update public.embryo_ingest_sessions set status='open' where id=pg_temp.sid('c')$$,
  '55000','embryo_write_fence_final','a fenced session cannot reopen');
select throws_ok($$update public.embryo_ingest_sessions set status='mapping_required' where id=pg_temp.sid('c')$$,
  '55000','embryo_write_fence_final','a fenced session cannot re-enter mapping');
select throws_ok($$update private.embryo_ingest_write_fences set fence_at=fence_at-interval '1 second'
  where session_id=pg_temp.sid('c')$$,'55000','immutable embryo write record','the fence time cannot be moved');
select throws_ok($$update private.embryo_ingest_write_intents set write_attempts=write_attempts+1,
  write_expires_at=write_expires_at+interval '1 minute' where session_id=pg_temp.sid('c') and sample_ordinal=1$$,
  '55000','immutable embryo write record','no window can be renewed after the fence');
select is(public.embryo_ingest_write_targets_v1(pg_temp.sid('c'),0),'{"status":"failure_pending"}'::jsonb,
  'a fenced session hands out no targets');
select is(public.settle_embryo_ingest_writes_v1(pg_temp.sid('c')),
  jsonb_build_object('status','draining','fenceAt',(pg_temp.fence('c')).fence_at),
  'before the fence time the session is draining');
select ok((select state='open' from pg_temp.intent('c',1)),'draining classifies nothing yet');
select pg_sleep((greatest(0,extract(epoch from (pg_temp.fence('c')).fence_at-clock_timestamp()))+0.05)::double precision);
create temporary table settled as select public.settle_embryo_ingest_writes_v1(pg_temp.sid('c')) body;
select is((select body->>'status' from settled),'settled','after the fence time the drain settles');
select is((select (body->>'landed')::integer from settled),1,'the committed write is counted landed');
select is((select (body->>'uncertain')::integer from settled),1,'the open write is counted uncertain');
select ok((select state='uncertain' and settled_at>=write_expires_at and storage_object_id is null
  from pg_temp.intent('c',1)),'the open intent is classified uncertain only after its window closed');
select ok((select state='landed' and settled_at is null from pg_temp.intent('c',0)),'the landed intent stays landed');
select is(public.settle_embryo_ingest_writes_v1(pg_temp.sid('c')),(select body from settled),
  'settling again returns the same receipt');
select ok((select f.settled_at=(s.body->>'settledAt')::timestamptz and f.landed_count=1 and f.uncertain_count=1
  from pg_temp.fence('c') f, settled s),'the settlement is recorded once');
select throws_ok($$update private.embryo_ingest_write_fences set uncertain_count=0 where session_id=pg_temp.sid('c')$$,
  '55000','immutable embryo write record','a settlement cannot be rewritten');
select throws_ok($$update private.embryo_ingest_write_intents set state='landed',storage_object_id=gen_random_uuid(),
  storage_version=gen_random_uuid()::text,landed_at=clock_timestamp()
  where session_id=pg_temp.sid('c') and sample_ordinal=1$$,'55000','immutable embryo write record',
  'an uncertain intent cannot later be recast as landed');

-- Any exit from the writable set fences, including success-path statuses.
insert into attempts values('d',pg_temp.new_attempt());
select is(pg_temp.reserve('d'),'reserved','the completion attempt reserves');
update public.embryo_ingest_sessions set status='complete' where id=pg_temp.sid('d');
select ok((pg_temp.fence('d')).fence_at>clock_timestamp(),'completion stamps a fence over the open windows');
select pg_temp.as_service();
set local role service_role;
select throws_ok($$select pg_temp.put(pg_temp.name_of('d',0))$$,'42501','embryo_object_unavailable',
  'a session that is not open refuses writes');
reset role;
select set_config('request.jwt.claims','',true);
select throws_ok($$update public.embryo_ingest_sessions set status='open' where id=pg_temp.sid('d')$$,
  '55000','embryo_write_fence_final','a completed session cannot reopen');
-- A session that left W before this migration would have no fence row.
delete from private.embryo_ingest_write_fences where session_id=pg_temp.sid('d');
select is(public.settle_embryo_ingest_writes_v1(pg_temp.sid('d'))->>'status','draining',
  'settle stamps a missing fence for a session already outside the writable set');
select ok((pg_temp.fence('d')).fence_at>=(select max(write_expires_at) from private.embryo_ingest_write_intents
  where session_id=pg_temp.sid('d')),'the restamped fence still waits for every open window');

-- An expired session still in W is failed by settle, then settled.
insert into attempts values('h',pg_temp.new_attempt(200000000,true));
update public.embryo_ingest_sessions set expires_at=clock_timestamp()+interval '50 milliseconds' where id=pg_temp.sid('h');
select pg_sleep(0.075);
select is(public.settle_embryo_ingest_writes_v1(pg_temp.sid('h'))->>'status','settled',
  'an expired writable session is failed and, with no writes, settles at once');
select ok((select status='failure_pending' and failure_code='expiry' from public.embryo_ingest_sessions
  where id=pg_temp.sid('h')),'the expiry is recorded as the attempt failure');
select ok((select fence_at=fenced_at and landed_count=0 and uncertain_count=0 from pg_temp.fence('h')),
  'with no open window the fence time is the stamp time');
select is(public.settle_embryo_ingest_writes_v1(gen_random_uuid()),'{"status":"denied"}'::jsonb,
  'an unknown session cannot be settled');

select is((select count(*) from public.embryo_ingest_sessions where status='published'),0::bigint,
  'no fixture published anything');
select * from finish();
rollback;
