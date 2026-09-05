begin;
select no_plan();
\ir fixtures/embryo_cohort_pre_finalize.inc

create temporary table minted as select private.finalize_embryo_cohort_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),(select insurance from acks),(select charter from acks),
  'nonce-unwind-final-001','http://localhost:3000',true) body;
create temporary table live as select s.* from public.embryo_ingest_sessions s
  where s.id=(select (body->'ingest'->>'session')::uuid from minted);
select lives_ok('select private.assert_embryo_unwind_matrix_v1((select cohort_id from live))',
  'complete frozen true-two-parent matrix is accepted for cleanup planning');
select is((select count(*) from public.consent_signatures where target_id=(select draft_id from draft)
  and artifact_key='attestation.embryo-single-parent-basis'),0::bigint,
  'true-two-parent cleanup begins with no single-parent artifact');
select is(public.prepare_embryo_ingest_unwind_v1((select cohort_id from live),(select ingest_revision from live))->>'status',
  'unavailable','an unfailed unexpired attempt cannot be unwound');
insert into public.embryo_ingest_chunks(session_id,sequence,content_sha256,byte_count,record_count,maximum_line_bytes)
  select id,0,repeat('b',64),100,1,100 from live;
select throws_ok($$insert into public.embryo_ingest_fragments(session_id,sequence,sample_ordinal,object_id,content_sha256,byte_count,line_count)
  select id,0,0,gen_random_uuid(),repeat('b',64),100,1 from live$$,'55000','ingest object binding unavailable',
  'unresolved source format/build cannot reserve a physical fragment key');
update public.embryo_ingest_sessions set source_format='vcf',reference_build='GRCh38' where id=(select id from live);
insert into public.embryo_ingest_fragments(session_id,sequence,sample_ordinal,object_id,content_sha256,byte_count,line_count)
  select id,0,0,gen_random_uuid(),repeat('b',64),100,1 from live;
select ok((select f.bucket_id='genomes' and f.object_name=s.account_id::text||'/'||s.cohort_id::text||'/'||s.upload_id::text||'/'||f.object_id::text||'.vcf'
  from public.embryo_ingest_fragments f join live s on s.id=f.session_id),
  'reserved fragment stores the exact server-owned cohort path before any upload');
select throws_ok($$update public.embryo_ingest_fragments set object_name='replacement' where session_id=(select id from live)$$,
  '55000','immutable ingest object','reserved object path cannot be retargeted');
update public.embryo_participant_sets set revoked_at=clock_timestamp()
  where cohort_id=(select cohort_id from live) and set_kind='record_key_recipients';
select lives_ok('select private.assert_embryo_unwind_matrix_v1((select cohort_id from live))',
  'revocation denies access but preserves exact originally issued-Card notice identity');
create function pg_temp.replaced_recipient_is_denied() returns void language plpgsql as $$ begin
  update public.embryo_participant_sets set membership_revision=membership_revision+1
    where cohort_id=(select cohort_id from live) and set_kind='record_key_recipients';
  perform private.assert_embryo_unwind_matrix_v1((select cohort_id from live));
end $$;
select throws_ok('select pg_temp.replaced_recipient_is_denied()','55000','unwind matrix unavailable',
  'replacement membership revision is not admitted as an issued-Card recipient');
select private.mark_embryo_ingest_failure_v1((select id from live),'stale-binding');
create function pg_temp.wrong_unwind_due(p_mutation text) returns void language plpgsql as $$ begin
  execute p_mutation;
  perform public.prepare_embryo_ingest_unwind_v1((select cohort_id from live),(select ingest_revision from live));
end $$;
select throws_ok($$select pg_temp.wrong_unwind_due('update public.retention_due_phases set target_id=gen_random_uuid() where target_id=(select id from live)')$$,
  '55000','unwind due authority unavailable','a retargeted due phase cannot authorize unwind planning');
select throws_ok($$select pg_temp.wrong_unwind_due('update public.retention_due_phases set recipient_authority_kind=''owner'' where target_id=(select id from live)')$$,
  '55000','unwind due authority unavailable','owner authority cannot replace the exact due recipient authority');
create table public.test_embryo_unwind_unknown_store(cohort_id uuid);
insert into public.test_embryo_unwind_unknown_store select cohort_id from live;
select throws_ok('select public.prepare_embryo_ingest_unwind_v1((select cohort_id from live),(select ingest_revision from live))',
  '55000','unsupported unwind store','a populated unknown target store is not silently skipped');
select is((select count(*) from public.embryo_ingest_unwinds),0::bigint,'unsupported store rolls back the plan');
drop table public.test_embryo_unwind_unknown_store;
create temporary table planned_unwind as select public.prepare_embryo_ingest_unwind_v1(
  (select cohort_id from live),(select ingest_revision from live)) body;
select is((select body->>'status' from planned_unwind),'storage_pending','failed attempt freezes its deletion plan');
select is((select count(*) from public.embryo_ingest_delete_objects where unwind_id=(select (body->>'unwindId')::uuid from planned_unwind)),
  1::bigint,'reserved but unacknowledged fragment is present in the exact deletion manifest');
select ok((select e.bucket_id=f.bucket_id and e.object_name=f.object_name
  from public.embryo_ingest_delete_objects e join public.embryo_ingest_fragments f on f.object_id=e.source_id),
  'deletion selects exact persisted object key, not a prefix guess');
select throws_ok($$update public.embryo_ingest_delete_objects set object_name='replacement'$$,
  '55000','immutable unwind object identity','manifest object identity cannot be retargeted');
select is(public.prepare_embryo_ingest_unwind_v1((select cohort_id from live),(select ingest_revision from live)),
  (select body from planned_unwind),'repeated dispatch resumes the same immutable plan');
select is((select jsonb_array_length(recipients) from public.embryo_ingest_unwinds),2,
  'plan preserves the exact two issued-Card recipient slots after access revocation');
select ok((select bool_and(fixed_ingest_deadline=s.expires_at) from public.embryo_ingest_unwinds u cross join live s),
  'planning does not renew the original ingest deadline');
select is((select count(*) from public.embryo_terminal_mail),0::bigint,
  'planning emits no premature no-source notice');
select is((select count(*) from public.embryo_cohorts where id=(select cohort_id from live)),1::bigint,
  'unknown in-flight write preserves failure graph until verified drain and deletion');

create temporary table notice_ids as select gen_random_uuid() id,gen_random_uuid() unwind_id,gen_random_uuid() recipient;
insert into public.embryo_terminal_mail(id,unwind_id,recipient_pseudonym,recipient_ciphertext,cleanup_confirmed_at,expires_at)
  select id,unwind_id,recipient,decode('010203','hex'),transaction_timestamp(),transaction_timestamp()+interval '24 hours' from notice_ids;
select ok(not has_table_privilege('authenticated','public.embryo_terminal_mail','SELECT'),
  'terminal ciphertext is unavailable to authenticated clients');
select ok(not has_function_privilege('authenticated','public.claim_embryo_terminal_mail_v1()','EXECUTE'),
  'only service delivery worker can claim terminal mail');
select is((select count(*) from pg_constraint where conrelid='public.embryo_terminal_mail'::regclass and contype='f'),
  0::bigint,'terminal envelope has no product principal, contact or target FK');
select throws_ok($$update public.embryo_terminal_mail set expires_at=expires_at+interval '1 hour'
  where id=(select id from notice_ids)$$,'55000','immutable terminal notice authority','retry cannot renew contact deadline');
create temporary table terminal_claimed as select * from public.claim_embryo_terminal_mail_v1();
select is((select count(*) from terminal_claimed),1::bigint,'due envelope can be claimed');
select is((select contact_ciphertext from terminal_claimed),'010203','worker sees ciphertext only');
select is((select count(*) from public.claim_embryo_terminal_mail_v1()),0::bigint,'active claim cannot be claimed twice');
select is(public.complete_embryo_terminal_mail_v1((select notice_id from terminal_claimed),gen_random_uuid(),true,repeat('a',64)),false,
  'wrong claim token cannot acknowledge a notice');
select is(public.complete_embryo_terminal_mail_v1((select notice_id from terminal_claimed),(select claim_token from terminal_claimed),true,repeat('a',64)),true,
  'accepted receipt completes only its exact claimed notice');
select ok((select recipient_ciphertext is null and state='accepted' from public.embryo_terminal_mail where id=(select id from notice_ids)),
  'accepted submission immediately deletes ciphertext');
select throws_ok($$update public.embryo_terminal_mail set recipient_ciphertext=decode('aa','hex'),state='queued',accepted_at=null
  where id=(select id from notice_ids)$$,'55000','immutable terminal notice authority','completed contact cannot be recreated');
insert into public.embryo_terminal_mail(unwind_id,recipient_pseudonym,recipient_ciphertext,cleanup_confirmed_at,expires_at,attempt_count)
  values(gen_random_uuid(),gen_random_uuid(),decode('040506','hex'),transaction_timestamp()-interval '25 hours',
    transaction_timestamp()-interval '1 hour',10);
select is(public.expire_embryo_terminal_mail_v1(),1,'fixed expiry shreds even an exhausted failed-delivery envelope');
select ok(not exists(select 1 from public.embryo_terminal_mail where expires_at<=clock_timestamp() and recipient_ciphertext is not null),
  'no expired recipient ciphertext remains after retention executor');
select * from finish();
rollback;
