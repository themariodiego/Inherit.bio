begin;
select no_plan();
-- Exact storage disposal of an unwound embryo upload (20260929101000), and
-- D-130. Every session is a synthetic signed two-parent attempt; provider
-- identities are synthetic strings. This proves what SQL accepts as evidence,
-- not what a provider did.
\ir fixtures/embryo_ingest_attempt.inc

create function pg_temp.fragments() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('ordinal',0,'sha256',repeat('b',64),'bytes',80,'lines',4),
    jsonb_build_object('ordinal',1,'sha256',repeat('c',64),'bytes',80,'lines',4));
$$;
create temporary table attempts(label text primary key, id uuid not null, unwind uuid);
grant select on attempts to service_role;
create function pg_temp.sid(p_label text) returns uuid language sql as $$
  select id from attempts where label=p_label;
$$;
create function pg_temp.uid(p_label text) returns uuid language sql as $$
  select unwind from attempts where label=p_label;
$$;
create function pg_temp.backend(p_provider text) returns void language sql as $$
  update private.embryo_ingest_object_config set provider=p_provider,
    r2_bucket=case p_provider when 'r2' then 'inherit-embryo-test' end where singleton;
$$;
create function pg_temp.attempt(p_label text, p_provider text) returns text language plpgsql as $$
begin
  perform pg_temp.backend(p_provider);
  insert into attempts(label,id) values(p_label,pg_temp.new_attempt());
  return private.reserve_embryo_ingest_chunk_v1(pg_temp.sid(p_label),0,repeat('d',64),100,2,60,pg_temp.fragments())->>'status';
end $$;
create function pg_temp.intent(p_label text, p_ordinal integer)
returns private.embryo_ingest_write_intents language sql as $$
  select * from private.embryo_ingest_write_intents
    where session_id=pg_temp.sid(p_label) and sequence=0 and sample_ordinal=p_ordinal;
$$;
create function pg_temp.land_r2(p_label text, p_ordinal integer) returns jsonb language sql as $$
  select private.ack_embryo_ingest_r2_write_v1(pg_temp.sid(p_label),0,p_ordinal,
    private.embryo_ingest_write_target_v1(pg_temp.intent(p_label,p_ordinal)),repeat('1',31)||p_ordinal::text,
    repeat('e',31)||p_ordinal::text,case p_ordinal when 0 then repeat('b',64) else repeat('c',64) end,80);
$$;
create function pg_temp.land_supabase(p_label text, p_ordinal integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  insert into storage.objects(bucket_id,name,version,metadata)
    values('genomes',(pg_temp.intent(p_label,p_ordinal)).object_name,gen_random_uuid()::text,'{"size":80}');
  perform set_config('request.jwt.claims','',true);
end $$;
-- Keep one window open a little longer, fail the attempt, plan the unwind.
create function pg_temp.fail_and_plan(p_label text, p_open_ordinal integer default null) returns text language plpgsql as $$
declare v jsonb;
begin
  if p_open_ordinal is not null then
    update private.embryo_ingest_write_intents set write_expires_at=clock_timestamp()+interval '1500 milliseconds'
      where session_id=pg_temp.sid(p_label) and sample_ordinal=p_open_ordinal and state='open';
  end if;
  perform private.mark_embryo_ingest_failure_v1(pg_temp.sid(p_label),'abort');
  v:=public.prepare_embryo_ingest_unwind_v1((select cohort_id from public.embryo_ingest_sessions where id=pg_temp.sid(p_label)),
    (select ingest_revision from public.embryo_ingest_sessions where id=pg_temp.sid(p_label)));
  update attempts set unwind=(v->>'unwindId')::uuid where label=p_label;
  return v->>'status';
end $$;
create function pg_temp.wait_fence(p_label text) returns void language sql as $$
  select pg_sleep((greatest(0,extract(epoch from (select fence_at from private.embryo_ingest_write_fences
    where session_id=pg_temp.sid(p_label))-clock_timestamp()))+0.05)::double precision);
$$;
create temporary table claims(label text, token text, body jsonb);
create function pg_temp.claim(p_label text, p_token text default repeat('a',64)) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  v:=public.claim_embryo_ingest_object_disposals_v1(pg_temp.uid(p_label),p_token);
  insert into claims values(p_label,p_token,v);
  return v;
end $$;
create function pg_temp.receipt(p_label text, p_ordinal bigint) returns jsonb language sql as $$
  select private.embryo_ingest_disposal_receipt_v1(d) from private.embryo_ingest_object_disposals d
    where unwind_id=pg_temp.uid(p_label) and ordinal=p_ordinal;
$$;
create function pg_temp.ordinal_of(p_label text, p_sample integer) returns bigint language sql as $$
  select o.ordinal from public.embryo_ingest_delete_objects o join public.embryo_ingest_fragments f
    on f.object_id=o.source_id where o.unwind_id=pg_temp.uid(p_label) and f.sample_ordinal=p_sample;
$$;
create function pg_temp.tombstone(p_label text, p_ordinal bigint, p_version text default repeat('9',32)) returns jsonb
language sql as $$
  select jsonb_build_object('version','embryo-ingest-object-tombstone-evidence-v1','provider','r2',
    'disposition','payload-tombstoned','bucket',r->>'bucket','objectKey',r->>'objectKey','providerVersion',p_version,
    'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,
    'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  from (select pg_temp.receipt(p_label,p_ordinal) r) x;
$$;
create function pg_temp.deleted(p_label text, p_ordinal bigint) returns jsonb language sql as $$
  select jsonb_build_object('version','embryo-ingest-object-delete-evidence-v1','provider','supabase',
    'disposition','object-deleted','objectId',r->'storageObjectId','bucket','genomes','objectKey',r->'objectKey',
    'storageVersion',r->'storageVersion','byteCount',80)
  from (select pg_temp.receipt(p_label,p_ordinal) r) x;
$$;
create function pg_temp.finish(p_label text, p_ordinal bigint, p_evidence jsonb, p_token text default repeat('a',64),
  p_expected jsonb default null) returns jsonb language sql as $$
  select public.finish_embryo_ingest_object_disposal_v1(pg_temp.uid(p_label),p_ordinal,p_token,
    coalesce(p_expected,pg_temp.receipt(p_label,p_ordinal)),p_evidence);
$$;
create function pg_temp.remove_object(p_name text) returns void language plpgsql as $$
begin
  perform set_config('storage.allow_delete_query','true',true);
  delete from storage.objects where bucket_id='genomes' and name=p_name;
end $$;

-- ---------------------------------------------------------------------------
-- Catalogue and grants
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid='private.embryo_ingest_object_disposals'::regclass),
  'disposal records have row-level security');
select ok(not has_table_privilege(r,'private.embryo_ingest_object_disposals',p),
  format('%s holds no %s on disposal records',r,p))
  from unnest(array['anon','authenticated','service_role','inherit_upload_only']) r,
    unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select ok(not has_table_privilege('service_role',t,p),format('the service role cannot %s %s directly',p,t))
  from unnest(array['public.embryo_ingest_unwinds','public.embryo_ingest_delete_objects']) t,
    unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p;
select ok(has_table_privilege('service_role',t,'SELECT'),format('the service role still reads %s',t))
  from unnest(array['public.embryo_ingest_unwinds','public.embryo_ingest_delete_objects']) t;
select ok(has_function_privilege('service_role',f,'EXECUTE'),format('the service role can call %s',f))
  from unnest(array['public.claim_embryo_ingest_object_disposals_v1(uuid,text)',
    'public.finish_embryo_ingest_object_disposal_v1(uuid,bigint,text,jsonb,jsonb)',
    'public.confirm_embryo_ingest_unwind_storage_v1(uuid)']) f;
select ok(not has_function_privilege(r,f,'EXECUTE'),format('%s cannot call %s',r,f))
  from unnest(array['anon','authenticated','inherit_upload_only']) r,
    unnest(array['public.claim_embryo_ingest_object_disposals_v1(uuid,text)',
      'public.finish_embryo_ingest_object_disposal_v1(uuid,bigint,text,jsonb,jsonb)',
      'public.confirm_embryo_ingest_unwind_storage_v1(uuid)']) f;
select ok(not has_function_privilege('service_role',f,'EXECUTE'),format('the service role cannot call internal %s',f))
  from unnest(array['private.embryo_ingest_unwind_unresolved_v1(uuid)',
    'private.embryo_ingest_unwind_unresolved_count_v1(uuid)',
    'private.guard_embryo_ingest_inventory_v1()','private.guard_embryo_ingest_unwind_state_v1()']) f;
select is((select target_id from public.purge_target_stores where store_name='private.embryo_ingest_object_disposals'),
  'upload-and-ingest-working-state','disposal records are registered with the ingest working-state purge target');
select throws_ok($$select public.claim_embryo_ingest_object_disposals_v1(gen_random_uuid(),'not-a-hash')$$,
  '22023','invalid_request','a claim token must be a SHA-256 hash');
select throws_ok($$select public.claim_embryo_ingest_object_disposals_v1(gen_random_uuid(),repeat('a',64))$$,
  '42501','embryo_unwind_unavailable','an unknown unwind cannot be claimed');

-- ---------------------------------------------------------------------------
-- D-130: an upload-staging object is inventoried under its recorded bucket
-- ---------------------------------------------------------------------------
select is(pg_temp.attempt('k','r2'),'reserved','the staging attempt reserves');
insert into public.upload_sessions(account_id,auth_session_id,cohort_id,staging_object_name,expected_size,
  content_type,upload_revision,expires_at,storage_bucket)
  select s.account_id,s.originating_session_id,s.cohort_id,gen_random_uuid()::text,100,'text/plain',1,
    clock_timestamp()+interval '1 hour','genomes'
  from public.embryo_ingest_sessions s where s.id=pg_temp.sid('k');
select is(pg_temp.fail_and_plan('k'),'storage_pending','the staging attempt is planned');
select is((select bucket_id from public.embryo_ingest_delete_objects where unwind_id=pg_temp.uid('k')
  and source_kind='upload-staging'),'genomes',
  'a staging object written to genomes is inventoried under genomes, not the old genomes-staging literal');
select pg_temp.wait_fence('k');
select is((public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.uid('k'))->'unresolved'->>'unsupported')::integer,1,
  'a staging object has no exact disposal contract yet, so it keeps the unwind unresolved');

-- ---------------------------------------------------------------------------
-- R2: every key, landed or uncertain, gets a verified empty marker
-- ---------------------------------------------------------------------------
select is(pg_temp.attempt('r','r2'),'reserved','the R2 attempt reserves two fragments');
select lives_ok($$select pg_temp.land_r2('r',0)$$,'one fragment lands');
select is(pg_temp.fail_and_plan('r',1),'storage_pending','the R2 attempt fails with one window still open');
select ok((select bool_and(o.bucket_id=i.provider_bucket and o.object_name=i.provider_key)
    and count(*)=2
  from public.embryo_ingest_delete_objects o join public.embryo_ingest_fragments f on f.object_id=o.source_id
    join private.embryo_ingest_write_intents i using (session_id,sequence,sample_ordinal)
  where o.unwind_id=pg_temp.uid('r')),
  'each R2 fragment is inventoried at its R2 bucket and key, not its fenced Supabase name');
select is(pg_temp.claim('r')->>'status','draining','nothing is claimed before the fence time');
select is(public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.uid('r')),
  '{"drain":"draining","status":"storage_pending"}'::jsonb,'nor can the unwind be confirmed');
select pg_temp.wait_fence('r');
create temporary table r_claim as select pg_temp.claim('r') body;
select is((select body->>'status' from r_claim),'claimed','after the fence time both keys are claimed');
select is((select jsonb_array_length(body->'objects') from r_claim),2,'the landed and the uncertain key alike');
select ok((select bool_and(value->>'operation'='tombstone' and value->>'backend'='r2'
    and value->>'bucket'='inherit-embryo-test' and value->>'objectKey' ~ '^embryo/' and value ? 'claimExpiresAt'
    and not value ? 'storageObjectId')
  from r_claim, jsonb_array_elements(body->'objects')),'each receipt asks for an empty marker at the exact key');
select ok((select state='uncertain' from pg_temp.intent('r',1)) and (select state='landed' from pg_temp.intent('r',0)),
  'claiming settled the drain: one landed, one uncertain');
select is(pg_temp.claim('r',repeat('b',64))->>'status','idle','a live claim cannot be taken over');

select throws_ok($$select pg_temp.finish('r',pg_temp.ordinal_of('r',0),pg_temp.tombstone('r',pg_temp.ordinal_of('r',0)),repeat('b',64))$$,
  '42501','embryo_unwind_unavailable','another claim token cannot finish');
select throws_ok($$select pg_temp.finish('r',pg_temp.ordinal_of('r',0),pg_temp.tombstone('r',pg_temp.ordinal_of('r',0)),
  repeat('a',64),pg_temp.receipt('r',pg_temp.ordinal_of('r',0))||'{"objectKey":"embryo/00000000-0000-4000-8000-000000000000"}')$$,
  '42501','embryo_unwind_unavailable','a receipt for another key cannot finish');
select throws_ok($$select pg_temp.finish('r',pg_temp.ordinal_of('r',0),
  pg_temp.tombstone('r',pg_temp.ordinal_of('r',0))||'{"etag":"00000000000000000000000000000000"}')$$,
  '22023','invalid_disposal_evidence','a marker that is not the empty object is refused');
select throws_ok($$select pg_temp.finish('r',pg_temp.ordinal_of('r',0),
  pg_temp.tombstone('r',pg_temp.ordinal_of('r',0))||'{"byteCount":1}')$$,
  '22023','invalid_disposal_evidence','a marker with bytes is refused');
select throws_ok($$select pg_temp.finish('r',pg_temp.ordinal_of('r',0),
  pg_temp.tombstone('r',pg_temp.ordinal_of('r',0),(pg_temp.intent('r',0)).provider_version))$$,
  '22023','invalid_disposal_evidence','the landed payload''s own version is not a marker');
select throws_ok($$select pg_temp.finish('r',pg_temp.ordinal_of('r',0),
  pg_temp.tombstone('r',pg_temp.ordinal_of('r',0))||'{"objectKey":"embryo/00000000-0000-4000-8000-000000000000"}')$$,
  '22023','invalid_disposal_evidence','a marker at another key is refused');
select throws_ok($$select pg_temp.finish('r',pg_temp.ordinal_of('r',0),
  pg_temp.tombstone('r',pg_temp.ordinal_of('r',0))||'{"extra":true}')$$,
  '22023','invalid_disposal_evidence','evidence with an extra field is refused');
select throws_ok($$select pg_temp.finish('r',pg_temp.ordinal_of('r',0),pg_temp.deleted('r',pg_temp.ordinal_of('r',0)))$$,
  '22023','invalid_disposal_evidence','a Supabase deletion is not evidence for an R2 key');
select throws_ok($$update public.embryo_ingest_delete_objects set state='tombstoned',acknowledged_at=clock_timestamp()
  where unwind_id=pg_temp.uid('r') and ordinal=pg_temp.ordinal_of('r',0)$$,
  '55000','embryo_unwind_disposal_unproved','even the owner cannot mark a row disposed without its evidence');
select throws_ok($$update public.embryo_ingest_delete_objects set state='missing',acknowledged_at=clock_timestamp()
  where unwind_id=pg_temp.uid('r') and ordinal=pg_temp.ordinal_of('r',1)$$,
  '55000','embryo_unwind_disposal_unproved','a missing object is never a disposal');
select throws_ok($$update public.embryo_ingest_unwinds set state='storage_confirmed',storage_confirmed_at=clock_timestamp()
  where id=pg_temp.uid('r')$$,'55000','embryo_unwind_storage_unresolved',
  'the unwind cannot be confirmed while any key is unproved');
select throws_ok($$delete from public.embryo_ingest_delete_objects where unwind_id=pg_temp.uid('k')$$,
  '55000','embryo_unwind_inventory_retained','an inventory row is kept until its unwind is confirmed');
set local role service_role;
select throws_ok($$update public.embryo_ingest_unwinds set state='storage_confirmed' where id=pg_temp.uid('r')$$,
  '42501',null,'the service role cannot write the unwind directly');
select throws_ok($$update public.embryo_ingest_delete_objects set state='tombstoned' where unwind_id=pg_temp.uid('r')$$,
  '42501',null,'the service role cannot write the inventory directly');
reset role;

create temporary table r_done as select pg_temp.finish('r',pg_temp.ordinal_of('r',0),
  pg_temp.tombstone('r',pg_temp.ordinal_of('r',0))) body;
select is((select body->>'state' from r_done),'tombstoned','the exact marker disposes of the landed key');
select is(pg_temp.finish('r',pg_temp.ordinal_of('r',0),pg_temp.tombstone('r',pg_temp.ordinal_of('r',0))),
  (select body from r_done),'an exact replay returns the same answer');
select throws_ok($$select pg_temp.finish('r',pg_temp.ordinal_of('r',0),pg_temp.tombstone('r',pg_temp.ordinal_of('r',0),repeat('8',32)))$$,
  '42501','embryo_unwind_unavailable','a replay with other evidence is refused');
select throws_ok($$update private.embryo_ingest_object_disposals set evidence='{}'
  where unwind_id=pg_temp.uid('r') and ordinal=pg_temp.ordinal_of('r',0)$$,
  '55000','immutable embryo disposal','a recorded disposal cannot be rewritten');
select is((public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.uid('r'))->'unresolved'->>'pending')::integer,1,
  'with the uncertain key unproved the unwind stays storage_pending');
select is(pg_temp.finish('r',pg_temp.ordinal_of('r',1),pg_temp.tombstone('r',pg_temp.ordinal_of('r',1)))->>'state',
  'tombstoned','the exact marker disposes of the uncertain key too');
create temporary table r_confirmed as select public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.uid('r')) body;
select is((select body->>'status' from r_confirmed),'storage_confirmed',
  'with every key proved the unwind is storage_confirmed');
select is(public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.uid('r'))->>'status','storage_confirmed',
  'confirming again is idempotent');
select is(pg_temp.claim('r',repeat('c',64)),'{"status":"storage_confirmed"}'::jsonb,
  'a confirmed unwind claims nothing');
select throws_ok($$update public.embryo_ingest_unwinds set state='storage_pending',storage_confirmed_at=null
  where id=pg_temp.uid('r')$$,'55000','embryo_unwind_state_order','a confirmed unwind never goes back');
select throws_ok($$delete from public.embryo_ingest_delete_objects where unwind_id=pg_temp.uid('r')$$,
  '23503',null,'a confirmed inventory row still cannot be deleted before its disposal record');

-- A lapsed R2 claim can be claimed again: the key is still there to mark.
select is(pg_temp.attempt('q','r2'),'reserved','the lapsed-claim attempt reserves');
select is(pg_temp.fail_and_plan('q'),'storage_pending','it fails with nothing landed');
select pg_temp.wait_fence('q');
select is(jsonb_array_length(pg_temp.claim('q')->'objects'),2,'both uncertain keys are claimed');
update private.embryo_ingest_object_disposals set claim_expires_at=clock_timestamp()-interval '1 second'
  where unwind_id=pg_temp.uid('q');
select throws_ok($$select pg_temp.finish('q',pg_temp.ordinal_of('q',0),pg_temp.tombstone('q',pg_temp.ordinal_of('q',0)))$$,
  '42501','embryo_unwind_unavailable','a lapsed claim cannot finish');
select is(jsonb_array_length(pg_temp.claim('q',repeat('d',64))->'objects'),2,'an R2 key is claimed again under a new token');
select is(pg_temp.finish('q',pg_temp.ordinal_of('q',0),pg_temp.tombstone('q',pg_temp.ordinal_of('q',0)),repeat('d',64))->>'state',
  'tombstoned','the new claim finishes');

-- ---------------------------------------------------------------------------
-- Supabase: exact-version deletion for landed objects; uncertain stays pending
-- ---------------------------------------------------------------------------
select is(pg_temp.attempt('s','supabase'),'reserved','the Supabase attempt reserves two fragments');
select lives_ok($$select pg_temp.land_supabase('s',0)$$,'one object lands in Storage');
select is(pg_temp.fail_and_plan('s',1),'storage_pending','the Supabase attempt fails with one window open');
select pg_temp.wait_fence('s');
create temporary table s_claim as select pg_temp.claim('s') body;
select is((select jsonb_array_length(body->'objects') from s_claim),1,'only the landed object is claimed');
select ok((select value->>'operation'='delete' and value->>'bucket'='genomes'
    and (value->>'storageObjectId')::uuid=(pg_temp.intent('s',0)).storage_object_id
    and value->>'storageVersion'=(pg_temp.intent('s',0)).storage_version
    and value->>'objectKey'=(pg_temp.intent('s',0)).object_name
  from s_claim, jsonb_array_elements(body->'objects')),'the receipt names the exact object id and version');
select throws_ok($$select pg_temp.finish('s',pg_temp.ordinal_of('s',0),pg_temp.deleted('s',pg_temp.ordinal_of('s',0)))$$,
  '42501','embryo_unwind_unavailable','a deletion is not accepted while the metadata row remains');
select pg_temp.remove_object((pg_temp.intent('s',0)).object_name);
select throws_ok($$select pg_temp.finish('s',pg_temp.ordinal_of('s',0),
  pg_temp.deleted('s',pg_temp.ordinal_of('s',0))||jsonb_build_object('storageVersion',gen_random_uuid()))$$,
  '22023','invalid_disposal_evidence','a deletion of another version is refused');
select throws_ok($$select pg_temp.finish('s',pg_temp.ordinal_of('s',0),pg_temp.tombstone('s',pg_temp.ordinal_of('s',0)))$$,
  '22023','invalid_disposal_evidence','an R2 marker is not evidence for a Supabase object');
select is(pg_temp.finish('s',pg_temp.ordinal_of('s',0),pg_temp.deleted('s',pg_temp.ordinal_of('s',0)))->>'state',
  'deleted','the exact deletion result disposes of the landed object');
select is(pg_temp.claim('s',repeat('b',64))->>'status','idle','the uncertain Supabase write is never claimed');
select ok((select (body->>'status')='storage_pending' and (body->'unresolved'->>'supabaseUncertain')::integer=1
  from (select public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.uid('s')) body) x),
  'an uncertain Supabase write keeps its unwind storage_pending');

-- A missing object or a lost acknowledgement remains unresolved.
select is(pg_temp.attempt('m','supabase'),'reserved','the missing-object attempt reserves');
select lives_ok($$select pg_temp.land_supabase('m',0)$$,'one object lands');
select lives_ok($$select pg_temp.land_supabase('m',1)$$,'the other lands');
select is(pg_temp.fail_and_plan('m'),'storage_pending','the attempt fails');
select pg_temp.remove_object((pg_temp.intent('m',0)).object_name);
select pg_temp.wait_fence('m');
select is(jsonb_array_length(pg_temp.claim('m')->'objects'),1,'a landed object whose metadata is already gone is not claimed');
select pg_temp.remove_object((pg_temp.intent('m',1)).object_name);
update private.embryo_ingest_object_disposals set claim_expires_at=clock_timestamp()-interval '1 second'
  where unwind_id=pg_temp.uid('m');
select throws_ok($$select pg_temp.finish('m',pg_temp.ordinal_of('m',1),pg_temp.deleted('m',pg_temp.ordinal_of('m',1)))$$,
  '42501','embryo_unwind_unavailable','a deletion reported after its claim lapsed is refused');
select is(pg_temp.claim('m',repeat('b',64))->>'status','idle','and the deleted object can never be claimed again');
select is((public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.uid('m'))->'unresolved'->>'pending')::integer,2,
  'both stay unresolved, and the unwind storage_pending');

select is((select count(*) from public.embryo_ingest_unwinds where state='storage_confirmed'
  and id in (select unwind from attempts)),1::bigint,'only the fully proved R2 unwind was confirmed');

-- ---------------------------------------------------------------------------
-- The generic worker claim never hands out a dedicated embryo job
-- ---------------------------------------------------------------------------
-- Other queued rows in a development database are pushed out of reach inside
-- this transaction, so the claim below sees only the three synthetic jobs.
update public.worker_jobs set not_before=clock_timestamp()+interval '1 day' where status='queued';
insert into public.worker_jobs(user_id,cohort_id,kind,output_kind,source_binding_kind,source_binding_id,
  source_binding_revision,file_sha256,computation_revision,idempotency_key,created_at)
  select s.account_id,s.cohort_id,'split_cohort_vcf','ingest.normalize','embryo-ingest-fragment-set',s.id,1,
    repeat('a',64),'split-v1',repeat('b',64),clock_timestamp()-interval '1 hour'
  from public.embryo_ingest_sessions s where s.id=pg_temp.sid('r');
insert into public.worker_jobs(user_id,cohort_id,kind,output_kind,source_binding_kind,source_binding_id,
  source_binding_revision,file_sha256,computation_revision,idempotency_key,created_at)
  select s.account_id,s.cohort_id,'score_embryo','embryo.single-locus','cohort-source-set',s.cohort_id,1,
    repeat('a',64),'score-v1',repeat('c',64),clock_timestamp()-interval '30 minutes'
  from public.embryo_ingest_sessions s where s.id=pg_temp.sid('r');
-- This is synthetic dispatch metadata only. Claiming it does not run a purge
-- or prove any retention disposition or storage deletion.
insert into public.worker_jobs(user_id,cohort_id,kind,output_kind,source_binding_kind,source_binding_id,
  source_binding_revision,file_sha256,computation_revision,idempotency_key)
  select s.account_id,s.cohort_id,'retention_purge','lifecycle.retention-purge','retention-disposition',s.cohort_id,1,
    repeat('a',64),'retention-v1',repeat('f',64)
  from public.embryo_ingest_sessions s where s.id=pg_temp.sid('r');
select is((private.claim_worker_job_v2('synthetic-worker',repeat('d',64),60)).kind,'retention_purge',
  'the generic claim passes over both older dedicated embryo jobs and takes the cleanup kind');
select ok(private.claim_worker_job_v2('synthetic-worker',repeat('e',64),60) is null,
  'with only dedicated embryo jobs queued, the generic claim returns nothing');
select is((select status from public.worker_jobs where kind='split_cohort_vcf' and source_binding_id=pg_temp.sid('r')),
  'queued','the split job is still queued for its own worker');
select is((select status from public.worker_jobs where kind='score_embryo'
  and idempotency_key=repeat('c',64)
  and source_binding_id=(select cohort_id from public.embryo_ingest_sessions where id=pg_temp.sid('r'))),
  'queued','the score job is still queued for its own worker');
select * from finish();
rollback;
