begin;
select no_plan();
-- The terminal graph purge of an abandoned embryo upload (20260930130000).
-- Attempt A is a completed synthetic upload whose split worker had staged a
-- pending embryo before the attempt failed; attempt B failed mid-upload on
-- the R2 backend with one write uncertain. Every genotype, digest and
-- provider identity is a synthetic string, and every address is .invalid.
\ir fixtures/embryo_ingest_completed.inc
\ir fixtures/embryo_ingest_attempt.inc

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create temporary table attempts(label text primary key, session uuid not null, unwind uuid);
create function pg_temp.sid(p_label text) returns uuid language sql as $$
  select session from attempts where label=p_label;
$$;
create function pg_temp.uid(p_label text) returns uuid language sql as $$
  select unwind from attempts where label=p_label;
$$;
create function pg_temp.complete(p_label text) returns jsonb language sql as $$
  select public.complete_embryo_ingest_unwind_v1(pg_temp.uid(p_label));
$$;
create function pg_temp.plan(p_label text) returns text language plpgsql as $$
declare v jsonb;
begin
  v:=public.prepare_embryo_ingest_unwind_v1((select cohort_id from public.embryo_ingest_sessions where id=pg_temp.sid(p_label)),
    (select ingest_revision from public.embryo_ingest_sessions where id=pg_temp.sid(p_label)));
  update attempts set unwind=(v->>'unwindId')::uuid where label=p_label;
  return v->>'status';
end $$;
create function pg_temp.wait_fence(p_label text) returns void language sql as $$
  select pg_sleep((greatest(0,extract(epoch from (select fence_at from private.embryo_ingest_write_fences
    where session_id=pg_temp.sid(p_label))-clock_timestamp()))+0.05)::double precision);
$$;
-- Dispose of every claimed object with its exact evidence: delete a
-- Supabase object by id, or record the gateway's verified empty marker.
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
          'providerVersion',repeat('9',31)||d.ordinal::text,'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,
          'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'));
    end if;
    n:=n+1;
  end loop;
  return n;
end $$;
-- Every identifier of an attempt's graph, captured before the purge.
create temporary table graph(label text, kind text, id uuid);
create temporary table graph_objects(label text, object text);
create function pg_temp.capture(p_label text) returns bigint language plpgsql as $$
declare s public.embryo_ingest_sessions%rowtype; c public.embryo_cohorts%rowtype;
begin
  select * into s from public.embryo_ingest_sessions where id=pg_temp.sid(p_label);
  select * into c from public.embryo_cohorts where id=s.cohort_id;
  insert into graph select p_label,k,i from (values ('session',s.id),('cohort',c.id),('draft',c.draft_id),
    ('job',s.worker_job_id)) v(k,i) where i is not null;
  insert into graph select p_label,'subject',id from public.subjects where cohort_id=c.id;
  insert into graph select p_label,'embryo',id from public.embryos where cohort_id=c.id;
  insert into graph select distinct p_label,'principal',p.principal_id from public.embryo_participant_sets p
    where p.cohort_id=c.id;
  insert into graph select p_label,'fragment',object_id from public.embryo_ingest_fragments where session_id=s.id;
  insert into graph select p_label,'part',id from private.embryo_canonical_parts where session_id=s.id;
  insert into graph select p_label,'storage-object',storage_object_id from private.embryo_ingest_write_intents
    where session_id=s.id and storage_object_id is not null;
  insert into graph select p_label,'signature',id from public.consent_signatures
    where target_kind='cohort_draft' and target_id=c.draft_id;
  insert into graph select p_label,'attestation',id from public.attestations
    where target_kind='cohort_draft' and target_id=c.draft_id;
  insert into graph select p_label,'invitation',id from public.subject_invitations
    where target_kind='cohort_draft' and target_id=c.draft_id;
  insert into graph select p_label,'rights-session',id from public.rights_sessions
    where target_kind='cohort_draft' and target_id=c.draft_id;
  insert into graph select p_label,'outbox',m.id from public.mail_outbox m
    where m.recipient_principal_id in (select id from graph where label=p_label and kind='principal');
  insert into graph select p_label,'contact',e.id from public.encrypted_contact_references e
    where e.principal_id in (select id from graph where label=p_label and kind='principal');
  insert into graph_objects select p_label,bucket_id||'/'||object_name from public.embryo_ingest_delete_objects
    where unwind_id=pg_temp.uid(p_label);
  return (select count(*) from graph where label=p_label);
end $$;
create function pg_temp.ids(p_label text) returns uuid[] language sql as $$
  select array_agg(id) from graph where label=p_label;
$$;
create function pg_temp.remaining(p_label text, p_kind text) returns bigint language plpgsql as $$
declare v_table text; n bigint;
begin
  v_table:=case p_kind when 'session' then 'public.embryo_ingest_sessions' when 'cohort' then 'public.embryo_cohorts'
    when 'draft' then 'public.embryo_cohort_drafts' when 'job' then 'public.worker_jobs' when 'subject' then 'public.subjects'
    when 'embryo' then 'public.embryos' when 'principal' then 'public.subject_principals'
    when 'fragment' then 'public.embryo_ingest_fragments' when 'signature' then 'public.consent_signatures'
    when 'attestation' then 'public.attestations' when 'invitation' then 'public.subject_invitations'
    when 'rights-session' then 'public.rights_sessions' when 'outbox' then 'public.mail_outbox'
    when 'contact' then 'public.encrypted_contact_references' when 'storage-object' then 'storage.objects'
    when 'part' then 'private.embryo_canonical_parts' end;
  execute format('select count(*) from %s where %I in (select id from graph where label=$1 and kind=$2)',
    v_table,case p_kind when 'fragment' then 'object_id' else 'id' end) into n using p_label,p_kind;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Catalogue and grants
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('service_role',f,'EXECUTE'),format('the service role can call %s',f))
  from unnest(array['public.complete_embryo_ingest_unwind_v1(uuid)','public.embryo_ingest_unwind_work_v1(integer)']) f;
select ok(not has_function_privilege(r,f,'EXECUTE'),format('%s cannot call %s',r,f))
  from unnest(array['anon','authenticated','inherit_upload_only']) r,
    unnest(array['public.complete_embryo_ingest_unwind_v1(uuid)','public.embryo_ingest_unwind_work_v1(integer)']) f;
select ok(not has_function_privilege('service_role',f,'EXECUTE'),format('the service role cannot call internal %s',f))
  from unnest(array['private.purge_embryo_ingest_attempt_v1(uuid)',
    'private.finish_embryo_published_cleanup_v1(uuid)',
    'private.embryo_ingest_attempt_residue_v1(uuid[],text[])',
    'private.plan_embryo_published_cleanup_v1()']) f;
select ok(not has_table_privilege('service_role','public.embryo_ingest_unwinds',p),
  format('the service role still cannot %s an unwind directly',p))
  from unnest(array['INSERT','UPDATE','DELETE']) p;
select throws_ok($$select public.complete_embryo_ingest_unwind_v1(gen_random_uuid())$$,
  '42501','embryo_unwind_unavailable','an unknown unwind cannot be completed');
select throws_ok($$select private.embryo_ingest_attempt_residue_v1('{}'::uuid[],'{}')$$,
  '22023','invalid_request','the residual check needs identifiers to look for');

-- ---------------------------------------------------------------------------
-- Attempt A: a completed upload with a staged split result, then failed
-- ---------------------------------------------------------------------------
insert into attempts(label,session) select 'a',id from live;
-- The attempt fixture cleared the R2 bucket; canonical parts always go to R2.
update private.embryo_ingest_object_config set r2_bucket='inherit-embryo-synthetic' where singleton;
update private.embryo_split_config set enabled=true;
update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
  claim_expires_at=null,claimed_by=null
  where kind='split_cohort_vcf' and id<>(select id from job) and status in ('queued','running');
select is((public.claim_embryo_split_job_v1(repeat('c',64),'synthetic-worker')->>'attempt')::integer,1,
  'the split worker claims attempt A''s job');
select is(public.stage_embryo_split_variants_v1((select id from job),1,repeat('c',64),0,0,
  '[[1,1000,"A","G","A/G"]]')->>'status','staged','it stages one synthetic genotype for embryo 1');
select is(pg_temp.land_parts(0,repeat('c',64)),2,'it copies embryo 1''s two fragments into canonical parts');
select is(public.finish_embryo_split_ordinal_v1((select id from job),1,repeat('c',64),0,
  jsonb_build_object('outcome','passed','qc',jsonb_build_object('sites_expected',10,'sites_called',10,
    'call_rate',1,'autosomal_het_rate',0.3,'mean_depth',null,'qc_verdict','pass','qc_reasons','[]'::jsonb),
    'failureReason',null,'variantCount',1))->>'outcome','passed','and records a pending outcome for it');
-- A copy for embryo 2 is reserved and never landed; a short claim bounds
-- its write window.
update public.worker_jobs set claim_expires_at=clock_timestamp()+interval '5 seconds' where id=(select id from job);
select is(public.reserve_embryo_canonical_part_v1((select id from job),1,repeat('c',64),1,0)->>'backend','r2',
  'a part for embryo 2 is reserved and left open');
select is(private.fail_embryo_split_v1(pg_temp.sid('a'),(select id from job),'stale-binding','cancelled')->>'status',
  'failure_pending','the attempt then fails');
select is(pg_temp.plan('a'),'storage_pending','the unwind is planned');
select is((select purpose from public.embryo_ingest_unwinds where id=pg_temp.uid('a')),'abandoned',
  'a planned unwind of a failed attempt is an abandoned-attempt unwind');

-- Structure: identity is frozen and inventory cannot be forged.
select throws_ok($$update public.embryo_ingest_unwinds set purpose='published' where id=pg_temp.uid('a')$$,
  '55000','embryo_unwind_identity','an unwind''s purpose never changes');
select throws_ok($$update public.embryo_ingest_unwinds set session_id=gen_random_uuid() where id=pg_temp.uid('a')$$,
  '55000','embryo_unwind_identity','an unwind''s session never changes before it completes');
select throws_ok($$insert into public.embryo_ingest_delete_objects(unwind_id,ordinal,bucket_id,object_name,source_kind,source_id,
    state,acknowledged_at) values (pg_temp.uid('a'),99,'genomes','forged','ingest-fragment',gen_random_uuid(),'deleted',clock_timestamp())$$,
  '55000','embryo_unwind_inventory_closed','an inventory row cannot be inserted already disposed');
select throws_ok($$insert into public.embryo_ingest_delete_objects(unwind_id,ordinal,bucket_id,object_name,source_kind,source_id)
    values (pg_temp.uid('a'),99,'genomes','late','ingest-fragment',gen_random_uuid())$$,
  '55000','embryo_unwind_inventory_closed','nothing is added to an inventory after planning');

-- Nothing is purged before storage is confirmed.
select is(pg_temp.complete('a'),'{"status":"storage_pending"}'::jsonb,
  'an unwind still waiting on storage is not purged');
select ok(exists(select 1 from public.embryo_cohorts where id=(select cohort_id from live))
    and exists(select 1 from public.embryo_ingest_sessions where id=pg_temp.sid('a'))
    and exists(select 1 from public.worker_jobs where id=(select id from job))
    and exists(select 1 from private.embryo_split_variants where session_id=pg_temp.sid('a')),
  'and its graph is untouched');
select ok((select public.embryo_ingest_unwind_work_v1(100) @> jsonb_build_array(jsonb_build_object(
    'unwindId',pg_temp.uid('a'),'purpose','abandoned','state','storage_pending'))),
  'the work list shows the unwind waiting on storage');

select is(private.embryo_ingest_attempt_residue_v1(array[gen_random_uuid()],
    array(select bucket_id||'/'||object_name from public.embryo_ingest_delete_objects where unwind_id=pg_temp.uid('a'))),
  '{"registered":{"storage.objects":6},"unregistered":{},"unverifiable":0}'::jsonb,
  'the residual check sees Storage metadata still at each fragment key');
select is((select count(*) from public.embryo_ingest_delete_objects where unwind_id=pg_temp.uid('a')
    and source_kind='canonical-part'),3::bigint,'the inventory lists every part of the session, landed or not');
select is(pg_temp.dispose_all('a'),8,'the six fragments and both landed parts are disposed of with exact evidence');
select is((public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.uid('a'))->'unresolved'->>'pending')::integer,1,
  'a part whose write window is still open is not claimed, and keeps storage unconfirmed');
select pg_sleep(greatest(0,extract(epoch from (select max(write_expires_at) from private.embryo_canonical_parts
  where session_id=pg_temp.sid('a'))-clock_timestamp()))+0.05);
select is(pg_temp.dispose_all('a'),1,'once its window has closed it gets a verified marker too');
select is(public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.uid('a'))->>'status','storage_confirmed',
  'the unwind is storage_confirmed');
select ok((select public.embryo_ingest_unwind_work_v1(100) @> jsonb_build_array(jsonb_build_object(
    'unwindId',pg_temp.uid('a'),'purpose','abandoned','state','storage_confirmed'))),
  'the work list shows the unwind ready to complete');
select cmp_ok(pg_temp.capture('a'),'>',30::bigint,'attempt A''s graph is captured before the purge');
create temporary table a_contacts as
  select (x->>'recipientPseudonym')::uuid pseudonym, e.contact_ciphertext
  from public.embryo_ingest_unwinds u, jsonb_array_elements(u.recipients) x
  join public.encrypted_contact_references e on e.principal_id=(x->>'principalId')::uuid and e.status='current'
  where u.id=pg_temp.uid('a');
select is((select count(*) from a_contacts),2::bigint,'both frozen recipients have one current contact');
create temporary table a_retention as select r.id from public.retention_rows r
  where r.target_id=pg_temp.sid('a') and r.retention_id='embryo.ingest-session-24h';

-- The residual check refuses what it cannot account for, and rolls it all back.
create table public.zz_purge_residue_probe(ref uuid);
insert into public.zz_purge_residue_probe values ((select cohort_id from live));
select throws_ok($$select pg_temp.complete('a')$$,'55000','embryo_unwind_residue',
  'a row in an unregistered table that still names the cohort stops the purge');
insert into public.purge_target_stores(target_id,store_name,store_order)
  values ('subject-relationships','public.zz_purge_residue_probe',99);
select throws_ok($$select pg_temp.complete('a')$$,'55000','embryo_unwind_residue',
  'so does the same row in a registered store');
delete from public.zz_purge_residue_probe;
insert into public.purge_target_stores(target_id,store_name,store_order)
  values ('subject-relationships','public.zz_purge_residue_missing',100);
select throws_ok($$select pg_temp.complete('a')$$,'55000','embryo_unwind_residue',
  'a registered store that cannot be examined stops the purge');
delete from public.purge_target_stores where store_name like 'public.zz_purge_residue_%';
drop table public.zz_purge_residue_probe;
select ok(exists(select 1 from public.embryo_cohorts where id=(select cohort_id from live))
    and (select state from public.embryo_ingest_unwinds where id=pg_temp.uid('a'))='storage_confirmed'
    and not exists(select 1 from public.embryo_terminal_mail where unwind_id=pg_temp.uid('a')),
  'a refused purge wrote nothing and deleted nothing');

create temporary table a_done as select pg_temp.complete('a') body;
select is((select body - 'completedAt' from a_done),
  '{"status":"complete","notices":2,"objects":9,"deliveryUnavailable":0}'::jsonb,
  'a storage-confirmed abandoned attempt is purged in one transaction');

-- Absence, proved
select is(private.embryo_ingest_attempt_residue_v1(pg_temp.ids('a'),
    (select array_agg(object) from graph_objects where label='a')),
  '{"registered":{},"unregistered":{},"unverifiable":0}'::jsonb,
  'no store names any deleted row, and no Storage metadata remains at any fragment key');
select is(pg_temp.remaining('a',k),0::bigint,format('no %s of attempt A remains',k))
  from (select distinct kind k from graph where label='a') x order by k;
select is((select count(*) from graph where label='a' and kind=k),n,format('the capture held %s %s rows',n,k))
  from (values ('subject',3::bigint),('embryo',3::bigint),('principal',2::bigint),('fragment',6::bigint),
    ('job',1::bigint),('part',3::bigint)) v(k,n);
select is((select count(*) from private.embryo_split_variants where session_id=pg_temp.sid('a'))
  +(select count(*) from private.embryo_split_ordinals where session_id=pg_temp.sid('a'))
  +(select count(*) from private.embryo_ingest_write_intents where session_id=pg_temp.sid('a'))
  +(select count(*) from private.embryo_ingest_write_fences where session_id=pg_temp.sid('a'))
  +(select count(*) from public.embryo_ingest_chunks where session_id=pg_temp.sid('a'))
  +(select count(*) from public.embryo_fragment_handle_maps where session_id=pg_temp.sid('a'))
  +(select count(*) from public.embryo_mapping_challenges where ingest_session_id=pg_temp.sid('a'))
  +(select count(*) from public.embryo_ingest_delete_objects where unwind_id=pg_temp.uid('a'))
  +(select count(*) from private.embryo_ingest_object_disposals where unwind_id=pg_temp.uid('a')),0::bigint,
  'no split row, write intent, fence, chunk, handle, challenge, inventory or disposal record remains');
select is((select count(*) from public.future_person_record_key_hashes where embryo_id=any(pg_temp.ids('a')))
  +(select count(*) from public.future_person_record_key_print_rights where embryo_id=any(pg_temp.ids('a')))
  +(select count(*) from public.future_person_record_key_recipients where cohort_id=(select cohort_id from live))
  +(select count(*) from public.embryo_participant_sets where cohort_id=(select cohort_id from live))
  +(select count(*) from public.embryo_basis_bindings where cohort_id=(select cohort_id from live))
  +(select count(*) from public.embryo_operation_nonces where target_id=any(pg_temp.ids('a'))),0::bigint,
  'every Record Key hash, print right, membership, basis binding and bound nonce is gone');
select ok(exists(select 1 from public.subject_principals where account_id='7a000000-0000-0000-0000-000000000001'
    and principal_kind='account_subject'),
  'the uploader''s own account principal is kept');
select ok(exists(select 1 from auth.users where id in ('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-0000-0000-000000000002')),'both parents'' accounts are kept');

-- The retention control tuple is terminalized, not deleted.
select is((select p.status||'/'||p.terminal_outcome_code||'/'||r.state from public.retention_due_phases p
    join public.retention_rows r on r.id=p.retention_row_id where r.id=(select id from a_retention)),
  'succeeded/ingest_abandoned_no_source/complete','the exact due phase records its one coded outcome');
select is((select state||':'||(cohort_id is null and session_id is null and draft_id is null and recipients is null
    and matrix_fingerprint is null)::text from public.embryo_ingest_unwinds where id=pg_temp.uid('a')),
  'complete:true','the unwind completes holding no live reference');

-- One terminal notice slot per frozen recipient, copied from its one
-- current contact, with the fixed 24-hour maximum.
select is((select count(*) from public.embryo_terminal_mail m join a_contacts k on k.pseudonym=m.recipient_pseudonym
    where m.unwind_id=pg_temp.uid('a') and m.state='queued' and m.recipient_ciphertext=k.contact_ciphertext
      and m.expires_at=m.cleanup_confirmed_at+interval '24 hours'),2::bigint,
  'each recipient gets exactly one queued notice with its own current contact');
select is((select count(*) from public.embryo_terminal_mail where unwind_id=pg_temp.uid('a')),2::bigint,
  'and no one else gets one');
select is((select jsonb_build_object('event',event_code,'principal',audit_principal_id,'context',coded_context)
    from public.legal_audit_log order by seq desc limit 1),
  '{"event":"embryo.ingest.abandoned-no-source","principal":null,
    "context":{"objects":9,"notices":2,"delivery_unavailable":0}}'::jsonb,
  'the audit event carries counts only, with no principal or identifier');

-- Replays
select is(pg_temp.complete('a') - 'completedAt','{"status":"complete"}'::jsonb,'completing again is a no-op');
select is(public.prepare_embryo_ingest_unwind_v1((select cohort_id from live),1),'{"status":"unavailable"}'::jsonb,
  'the deleted cohort cannot be planned again');
select ok(not (public.embryo_ingest_unwind_work_v1(100) @> jsonb_build_array(jsonb_build_object('unwindId',pg_temp.uid('a')))),
  'a completed unwind leaves the work list');

-- ---------------------------------------------------------------------------
-- Attempt B: an R2 upload that failed mid-write; one recipient's contact
-- was rotated away
-- ---------------------------------------------------------------------------
update private.embryo_ingest_object_config set provider='r2',r2_bucket='inherit-embryo-test' where singleton;
insert into attempts(label,session) values ('b',pg_temp.new_attempt());
select is(private.reserve_embryo_ingest_chunk_v1(pg_temp.sid('b'),0,repeat('d',64),100,2,60,jsonb_build_array(
    jsonb_build_object('ordinal',0,'sha256',repeat('b',64),'bytes',80,'lines',4),
    jsonb_build_object('ordinal',1,'sha256',repeat('c',64),'bytes',80,'lines',4)))->>'status',
  'reserved','attempt B reserves two R2 fragments');
select is(private.ack_embryo_ingest_r2_write_v1(pg_temp.sid('b'),0,0,
    private.embryo_ingest_write_target_v1(i),repeat('1',32),repeat('e',32),repeat('b',64),80)->>'providerVersion',repeat('1',32),
  'one fragment lands on R2')
  from private.embryo_ingest_write_intents i where i.session_id=pg_temp.sid('b') and i.sample_ordinal=0;
update private.embryo_ingest_write_intents set write_expires_at=clock_timestamp()+interval '1500 milliseconds'
  where session_id=pg_temp.sid('b') and sample_ordinal=1 and state='open';
select is(private.mark_embryo_ingest_failure_v1(pg_temp.sid('b'),'abort')->>'status','failure_pending',
  'attempt B is aborted with a write window still open');
select is(pg_temp.plan('b'),'storage_pending','attempt B is planned');
select pg_temp.wait_fence('b');
select is(pg_temp.dispose_all('b'),2,'both keys, landed and uncertain, get a verified marker');
select is(public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.uid('b'))->>'status','storage_confirmed',
  'attempt B is storage_confirmed');
select cmp_ok(pg_temp.capture('b'),'>',20::bigint,'attempt B''s graph is captured');
create temporary table b_rotated as
  select (x->>'recipientPseudonym')::uuid pseudonym, e.id contact_id
  from public.embryo_ingest_unwinds u, jsonb_array_elements(u.recipients) x
  join public.encrypted_contact_references e on e.principal_id=(x->>'principalId')::uuid and e.status='current'
  where u.id=pg_temp.uid('b') order by x->>'principalId' limit 1;
update public.encrypted_contact_references set status='rotated',ended_at=clock_timestamp()
  where id=(select contact_id from b_rotated);
select is(pg_temp.complete('b') - 'completedAt',
  '{"status":"complete","notices":2,"objects":2,"deliveryUnavailable":1}'::jsonb,
  'attempt B is purged; the recipient without a current contact gets a delivery-unavailable slot');
select is((select state||':'||(recipient_ciphertext is null)::text from public.embryo_terminal_mail
    where unwind_id=pg_temp.uid('b') and recipient_pseudonym=(select pseudonym from b_rotated)),
  'delivery_unavailable:true','a rotated contact is never revived');
select is((select count(*) from public.embryo_terminal_mail where unwind_id=pg_temp.uid('b') and state='queued'
    and recipient_ciphertext is not null),1::bigint,'the other recipient''s notice is queued');
select is(private.embryo_ingest_attempt_residue_v1(pg_temp.ids('b'),
    (select array_agg(object) from graph_objects where label='b')),
  '{"registered":{},"unregistered":{},"unverifiable":0}'::jsonb,'nothing of attempt B remains either');
select is(pg_temp.remaining('b',k),0::bigint,format('no %s of attempt B remains',k))
  from (select distinct kind k from graph where label='b') x order by k;

select * from finish();
rollback;
