begin;
select no_plan();
-- Embryo fragments on R2 (20260929100000). Every session is a synthetic signed
-- two-parent attempt. Provider identities below are synthetic strings: this
-- suite proves what SQL accepts, not what a provider stored.
\ir fixtures/embryo_ingest_attempt.inc
update private.embryo_ingest_object_config set provider='r2',r2_bucket='inherit-embryo-test' where singleton;

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
create function pg_temp.reserve(p_label text) returns text language sql as $$
  select private.reserve_embryo_ingest_chunk_v1(pg_temp.sid(p_label),0,repeat('d',64),100,2,60,pg_temp.fragments())->>'status';
$$;
create function pg_temp.intent(p_label text, p_ordinal integer)
returns private.embryo_ingest_write_intents language sql as $$
  select * from private.embryo_ingest_write_intents
    where session_id=pg_temp.sid(p_label) and sequence=0 and sample_ordinal=p_ordinal;
$$;
create function pg_temp.receipt(p_label text, p_ordinal integer) returns jsonb language sql as $$
  select value->'receipt' from jsonb_array_elements(
    public.embryo_ingest_write_targets_v1(pg_temp.sid(p_label),0)->'targets')
  where (value->'receipt'->>'ordinal')::integer=p_ordinal;
$$;
-- The transport's report after its create-only PUT and exact read-back.
create function pg_temp.ack(p_label text, p_ordinal integer, p_receipt jsonb default null,
  p_version text default null, p_etag text default null, p_sha text default null, p_bytes bigint default 80)
returns jsonb language sql as $$
  select public.ack_embryo_ingest_r2_write_v1(pg_temp.sid(p_label),0,p_ordinal,
    coalesce(p_receipt,pg_temp.receipt(p_label,p_ordinal)),coalesce(p_version,repeat('1',31)||p_ordinal::text),
    coalesce(p_etag,repeat('e',31)||p_ordinal::text),
    coalesce(p_sha,case p_ordinal when 0 then repeat('b',64) else repeat('c',64) end),p_bytes);
$$;
create function pg_temp.commit(p_label text) returns text language sql as $$
  select private.commit_embryo_ingest_chunk_v1(pg_temp.sid(p_label),0,repeat('d',64))->>'status';
$$;

-- ---------------------------------------------------------------------------
-- Configuration, catalogue and grants
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid='private.embryo_ingest_object_config'::regclass),
  'the backend configuration has row-level security');
select ok(not has_table_privilege(r,'private.embryo_ingest_object_config',p),
  format('%s holds no %s on the backend configuration',r,p))
  from unnest(array['anon','authenticated','service_role','inherit_upload_only']) r,
    unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select ok(has_function_privilege('service_role',
  'public.ack_embryo_ingest_r2_write_v1(uuid,integer,integer,jsonb,text,text,text,bigint)','EXECUTE'),
  'the service role can call the R2 landing door');
select ok(not has_function_privilege(r,f,'EXECUTE'),format('%s cannot call %s',r,f))
  from unnest(array['anon','authenticated','inherit_upload_only']) r,
    unnest(array['public.ack_embryo_ingest_r2_write_v1(uuid,integer,integer,jsonb,text,text,text,bigint)',
      'private.ack_embryo_ingest_r2_write_v1(uuid,integer,integer,jsonb,text,text,text,bigint)']) f;
select ok(not has_function_privilege(r,f,'EXECUTE'),format('%s cannot call internal %s',r,f))
  from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r,
    unnest(array['private.lock_embryo_ingest_landing_v1(uuid,integer,integer,boolean)',
      'private.embryo_ingest_write_target_v1(private.embryo_ingest_write_intents)',
      'private.embryo_ingest_stored_fragment_v1(private.embryo_ingest_write_intents)']) f;
select ok((select not prosecdef from pg_proc
    where oid='public.ack_embryo_ingest_r2_write_v1(uuid,integer,integer,jsonb,text,text,text,bigint)'::regprocedure)
  and (select prosecdef from pg_proc
    where oid='private.ack_embryo_ingest_r2_write_v1(uuid,integer,integer,jsonb,text,text,text,bigint)'::regprocedure),
  'the landing door is an invoker over a private definer');
select throws_ok($$update private.embryo_ingest_object_config set provider='r2',r2_bucket=null$$,'23514',null,
  'R2 cannot be selected without a bucket');
select throws_ok($$update private.embryo_ingest_object_config set r2_bucket='inherit-prepared-production'$$,'23514',null,
  'the prepared-object bucket cannot hold embryo fragments');

insert into attempts values('u',pg_temp.new_attempt());
update private.embryo_ingest_object_config set provider=null,r2_bucket=null where singleton;
select throws_ok($$select pg_temp.reserve('u')$$,'55000','embryo_object_backend_unavailable',
  'with no backend selected, no fragment can be reserved');
update private.embryo_ingest_object_config set provider='r2',r2_bucket='inherit-embryo-test' where singleton;
select is(pg_temp.reserve('u'),'reserved','once R2 is selected the same reservation succeeds');

-- ---------------------------------------------------------------------------
-- R2 intents and targets
-- ---------------------------------------------------------------------------
insert into attempts values('a',pg_temp.new_attempt());
select is(pg_temp.reserve('a'),'reserved','the primary attempt reserves two fragments');
select ok((select bool_and(i.backend='r2' and i.provider_bucket='inherit-embryo-test'
    and i.provider_key='embryo/'||f.object_id and i.sha256=f.content_sha256 and i.byte_count=f.byte_count
    and i.object_name=f.object_name and i.state='open')
  from private.embryo_ingest_write_intents i join public.embryo_ingest_fragments f using (session_id,sequence,sample_ordinal)
  where i.session_id=pg_temp.sid('a')),
  'each intent is bound to an opaque embryo/<object id> key in the configured bucket, with the fragment hash');
select ok((select bool_and(position(s.account_id::text in i.provider_key)=0 and position(s.cohort_id::text in i.provider_key)=0)
  from private.embryo_ingest_write_intents i join public.embryo_ingest_sessions s on s.id=i.session_id
  where i.session_id=pg_temp.sid('a')),'the R2 key names no account and no cohort');
select is(pg_temp.receipt('a',0),(select jsonb_build_object('version','embryo-ingest-write-target-v1',
    'sessionId',session_id,'sequence',0,'ordinal',0,'backend','r2','bucket','inherit-embryo-test',
    'objectKey',provider_key,'byteCount',80,'sha256',repeat('b',64),'writeExpiresAt',write_expires_at)
  from pg_temp.intent('a',0)),'targets give the writer the exact receipt it must present');

-- The fenced Supabase name of an R2 fragment can never gain a metadata row.
create temporary table fenced_name as select (pg_temp.intent('a',0)).object_name n;
grant select on fenced_name to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$insert into storage.objects(bucket_id,name,version,metadata)
  values('genomes',(select n from fenced_name),gen_random_uuid()::text,'{"size":80}')$$,
  '42501','embryo_object_unavailable','the Supabase name reserved for an R2 fragment is refused');
reset role;
select set_config('request.jwt.claims','',true);

-- ---------------------------------------------------------------------------
-- The landing door: refusals
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.ack('a',0,null,'not-a-version')$$,'22023','invalid_request',
  'a provider version that is not 32 hex characters is refused before any lock');
select throws_ok($$select pg_temp.ack('a',0,null,null,'ETAG')$$,'22023','invalid_request',
  'a malformed ETag is refused');
select throws_ok($$select pg_temp.ack('a',0,null,null,null,repeat('f',64))$$,'42501','embryo_object_unavailable',
  'a read-back hash other than the reserved hash is refused');
select throws_ok($$select pg_temp.ack('a',0,null,null,null,null,81)$$,'42501','embryo_object_unavailable',
  'a read-back size other than the reserved size is refused');
select throws_ok($$select pg_temp.ack('a',0,pg_temp.receipt('a',0)||'{"objectKey":"embryo/00000000-0000-4000-8000-000000000000"}')$$,
  '42501','embryo_object_unavailable','a receipt naming another key is refused');
select throws_ok($$select pg_temp.ack('a',0,pg_temp.receipt('a',1))$$,'42501','embryo_object_unavailable',
  'the receipt of a sibling fragment is refused');
select throws_ok($$select public.ack_embryo_ingest_r2_write_v1(pg_temp.sid('a'),0,7,pg_temp.receipt('a',0),
  repeat('1',32),repeat('e',32),repeat('b',64),80)$$,'42501','embryo_object_unavailable',
  'an ordinal with no intent is refused');
select throws_ok($$select public.ack_embryo_ingest_r2_write_v1(gen_random_uuid(),0,0,pg_temp.receipt('a',0),
  repeat('1',32),repeat('e',32),repeat('b',64),80)$$,'42501','embryo_object_unavailable',
  'an unknown session is refused');
select ok((select state='open' from pg_temp.intent('a',0)),'no refusal landed anything');

-- ---------------------------------------------------------------------------
-- Landing, replay and the commit gate
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.commit('a')$$,'55000','embryo_chunk_objects_unlanded',
  'no fragment landed: the chunk cannot commit');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
create temporary table landed as select pg_temp.ack('a',0) body;
reset role;
select set_config('request.jwt.claims','',true);
select is((select body from landed),(select jsonb_build_object('receipt',pg_temp.receipt('a',0),
  'providerVersion',repeat('1',31)||'0','etag',repeat('e',31)||'0')),
  'the service writer lands the fragment and gets back its receipt and provider identity');
select ok((select state='landed' and provider_version=repeat('1',31)||'0' and provider_etag=repeat('e',31)||'0'
    and observed_sha256=sha256 and landed_at<write_expires_at and storage_object_id is null
  from pg_temp.intent('a',0)),'the intent records the exact provider version, ETag and read-back hash');
select is(pg_temp.ack('a',0),(select body from landed),'an exact replay returns the same answer');
select throws_ok($$select pg_temp.ack('a',0,null,repeat('2',32))$$,'42501','embryo_object_unavailable',
  'a replay naming another provider version is refused');
select throws_ok($$select pg_temp.ack('a',0,null,null,repeat('f',32))$$,'42501','embryo_object_unavailable',
  'a replay naming another ETag is refused');
select is((select value->'stored' from jsonb_array_elements(
    public.embryo_ingest_write_targets_v1(pg_temp.sid('a'),0)->'targets') where value->>'state'='landed'),
  jsonb_build_object('providerVersion',repeat('1',31)||'0','etag',repeat('e',31)||'0'),
  'targets report the stored identity of a landed fragment');
select throws_ok($$select pg_temp.commit('a')$$,'55000','embryo_chunk_objects_unlanded',
  'one of two fragments landed: the chunk cannot commit');
select lives_ok($$select pg_temp.ack('a',1)$$,'the second fragment lands');
select is(pg_temp.commit('a'),'stored','with both fragments landed on R2 the chunk commits');
select throws_ok($$update private.embryo_ingest_write_intents set provider_key='embryo/00000000-0000-4000-8000-000000000000'
  where session_id=pg_temp.sid('a') and sample_ordinal=0$$,'55000','immutable embryo write record',
  'a landed location cannot be rewritten');
select throws_ok($$update private.embryo_ingest_write_intents set backend='supabase',provider_bucket='genomes',
  provider_key=object_name where session_id=pg_temp.sid('u') and sample_ordinal=0$$,'55000','immutable embryo write record',
  'an open intent cannot change backend');

-- A stale receipt cannot land after its window, nor after renewal.
insert into attempts values('b',pg_temp.new_attempt());
select is(pg_temp.reserve('b'),'reserved','the renewal attempt reserves');
create temporary table stale as select pg_temp.receipt('b',0) receipt;
update private.embryo_ingest_write_intents set write_expires_at=clock_timestamp()+interval '50 milliseconds'
  where session_id=pg_temp.sid('b') and sample_ordinal=0;
select pg_sleep(0.075);
select throws_ok($$select pg_temp.ack('b',0,'true'::jsonb)$$,'22023',
  'invalid_request','a receipt that is not an object is refused');
select throws_ok($$select pg_temp.ack('b',0,(select private.embryo_ingest_write_target_v1(i) from pg_temp.intent('b',0) i))$$,
  '42501','embryo_object_unavailable','an ACK after the window closed is refused');
create temporary table renewed as select pg_temp.receipt('b',0) receipt;
select ok((select write_attempts=2 and write_expires_at>clock_timestamp() from pg_temp.intent('b',0)),
  'reading targets renewed the window');
select throws_ok($$select pg_temp.ack('b',0,(select receipt from stale))$$,'42501','embryo_object_unavailable',
  'the receipt from the first window cannot land in the second');
select lives_ok($$select pg_temp.ack('b',0,(select receipt from renewed))$$,'the renewed receipt lands');

-- Authority and the fence.
insert into attempts values('c',pg_temp.new_attempt());
select is(pg_temp.reserve('c'),'reserved','the revocation attempt reserves');
create temporary table revoked_receipt as select pg_temp.receipt('c',0) receipt;
update public.profiles set auth_session_revision=auth_session_revision+1
  where id=(select account_id from public.embryo_ingest_sessions where id=pg_temp.sid('c'));
select throws_ok($$select pg_temp.ack('c',0,(select receipt from revoked_receipt))$$,'42501','embryo_object_unavailable',
  'a revoked authenticated session cannot land a fragment');
select ok((select state='open' from pg_temp.intent('c',0)),'the refusal persisted nothing');

insert into attempts values('d',pg_temp.new_attempt());
select is(pg_temp.reserve('d'),'reserved','the fence attempt reserves');
select lives_ok($$select pg_temp.ack('d',0)$$,'one fragment lands before the failure');
create temporary table fenced_receipt as select pg_temp.receipt('d',1) receipt;
update private.embryo_ingest_write_intents set write_expires_at=clock_timestamp()+interval '2 seconds'
  where session_id=pg_temp.sid('d') and sample_ordinal=1;
update fenced_receipt set receipt=(select private.embryo_ingest_write_target_v1(i) from pg_temp.intent('d',1) i);
select private.mark_embryo_ingest_failure_v1(pg_temp.sid('d'),'abort');
select throws_ok($$select pg_temp.ack('d',1,(select receipt from fenced_receipt))$$,'42501','embryo_object_unavailable',
  'a fenced session refuses an ACK even inside the window');
select is(public.settle_embryo_ingest_writes_v1(pg_temp.sid('d'))->>'status','draining',
  'the R2 drain waits for the last window like the Supabase one');
select pg_sleep((greatest(0,extract(epoch from (select fence_at from private.embryo_ingest_write_fences
  where session_id=pg_temp.sid('d'))-clock_timestamp()))+0.05)::double precision);
create temporary table settled as select public.settle_embryo_ingest_writes_v1(pg_temp.sid('d')) body;
select is((select (body->>'landed')::integer from settled),1,'the acknowledged R2 fragment is landed');
select is((select (body->>'uncertain')::integer from settled),1,'the unacknowledged R2 fragment is uncertain');
select ok((select state='uncertain' and provider_version is null from pg_temp.intent('d',1)),
  'an uncertain R2 intent names no provider version');

-- A Supabase intent cannot be landed through the R2 door.
update private.embryo_ingest_object_config set provider='supabase',r2_bucket=null where singleton;
insert into attempts values('s',pg_temp.new_attempt());
select is(pg_temp.reserve('s'),'reserved','a Supabase-backed attempt reserves');
select ok((select backend='supabase' and provider_bucket='genomes' and provider_key=object_name
  from pg_temp.intent('s',0)),'a Supabase intent writes to its fenced genomes name');
select throws_ok($$select pg_temp.ack('s',0)$$,'42501','embryo_object_unavailable',
  'the R2 door refuses a Supabase-backed intent');
select ok((select backend='r2' from pg_temp.intent('a',0)),
  'changing the configuration does not move an issued intent');

select is((select count(*) from public.embryo_ingest_sessions where status='published'),0::bigint,
  'no fixture published anything');
select * from finish();
rollback;
