begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- D-152, second half (migration 20261122130000_file_delete_live_exports_only;
-- owner decision of 22 November 2026, "Withdrawing consent for one's own file
-- ends a finished download copy too"): the own-file withdrawal (the self
-- emptying) ends every whole-account copy of the account whose parts include
-- the record, a finished (READY) one as well as one queued or being built,
-- the way it ends the record's own copies (D-144): each attempt still holding
-- or writing objects is stopped through the export cleanup door, then the
-- copy is revoked. A copy whose parts do not include the record is not
-- touched. Every copy here is made, opened and read through the current
-- doors; the states only time or another door would make (an expiry passing,
-- parts without the record, a status-only revocation, a legacy-form download
-- session) are synthetic fixtures named as such. The TEST R2 configuration is
-- the transaction-local synthetic one the export suites use; no provider is
-- called. Each case runs in its own savepoint. Everything rolls back.
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
\ir fixtures/account_archive_ordinary_scientific.inc
update storage.objects set version='77900000-0000-4000-8000-000000000021' where id='77900000-0000-4000-8000-000000000020';
update auth.users set email_confirmed_at=clock_timestamp() where id='77900000-0000-4000-8000-000000000001';
select is(public.declare_jurisdiction_v2('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010','GB',null,
 (select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),true)->>'jurisdiction','GB',
 'fixture: the person declares a country through the current writer, as a TEST READY export needs');
update private.account_archive_r2_configuration set enabled=true,bucket='inherit-export-test',binding_sha256=repeat('2',64);
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('7d152000-0000-4000-8000-000000000102','d152-withdrawal-beta@example.invalid',clock_timestamp(),'{}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('7d152000-0000-4000-8000-000000000112','7d152000-0000-4000-8000-000000000102',clock_timestamp(),clock_timestamp(),'aal1');

create temporary table fx as select
 '77900000-0000-4000-8000-000000000001'::uuid alpha,
 '77900000-0000-4000-8000-000000000010'::uuid alpha_session,
 (select id from normalization_subject) alpha_subject,
 '77900000-0000-4000-8000-000000000040'::uuid file,
 '7d152000-0000-4000-8000-000000000102'::uuid beta,
 '7d152000-0000-4000-8000-000000000112'::uuid beta_session,
 (select id from public.subjects where subject_account_id='7d152000-0000-4000-8000-000000000102' and subject_class='self') beta_subject;
grant select on fx to service_role;

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('self-withdrawal-finished-copies-test:'||p,'sha256'),'hex') $$;
create function pg_temp.notice() returns jsonb language sql stable as
 $$ select jsonb_build_object('contactCiphertext',repeat('ab',40),'contactHmac',repeat('c',64),
  'contactRevision',(select mail_contact_revision from public.profiles where id=(select alpha from fx))) $$;
-- The own-file withdrawal, through the door api.subject-delete sends a self record to.
create function pg_temp.withdraw(p_code text) returns jsonb language sql volatile as
 $$ select public.empty_self_subject_with_notice_v1((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),
  pg_temp.h(p_code),clock_timestamp()+interval '5 minutes',pg_temp.notice()) $$;

-- Copies, each through its own doors. A 'record' copy is a record's own
-- export (api.subject-export), an 'account' copy the whole account's (api.export).
create temporary table ex(label text primary key,kind text,account uuid,session uuid,target uuid,attempt uuid,cookie text,
 capture jsonb,created jsonb,frame jsonb,ready jsonb,download uuid);
insert into ex(label,kind,account,session,target,attempt,cookie)
select label,kind,fx.alpha,fx.alpha_session,case kind when 'record' then fx.alpha_subject else fx.alpha end,attempt::uuid,repeat(cookie,64)
from fx,(values
 ('account-queued','account','7d152000-0000-4000-8000-0000000001a1','1'),('account-writing','account','7d152000-0000-4000-8000-0000000001a2','2'),
 ('account-bytes','account','7d152000-0000-4000-8000-0000000001a3','3'),('account-ready','account','7d152000-0000-4000-8000-0000000001a4','4'),
 ('account-expired','account','7d152000-0000-4000-8000-0000000001a5','5'),('account-failed','account','7d152000-0000-4000-8000-0000000001a6','6'),
 ('account-revoked','account','7d152000-0000-4000-8000-0000000001a7','7'),('account-elsewhere','account','7d152000-0000-4000-8000-0000000001a8','8'),
 ('record-ready','record','7d152000-0000-4000-8000-0000000001a9','9')) x(label,kind,attempt,cookie)
union all select 'beta-account','account',beta,beta_session,beta,'7d152000-0000-4000-8000-0000000001aa',repeat('a',64) from fx
union all select 'beta-record','record',beta,beta_session,beta_subject,'7d152000-0000-4000-8000-0000000001ab',repeat('b',64) from fx;
grant select on ex to service_role;
create function pg_temp.origin(p_label text) returns jsonb language sql stable as
 $$ select jsonb_build_object('kind','account','accountId',account,'sessionId',session) from ex where label=p_label $$;
create function pg_temp.export_id(p_label text) returns uuid language sql stable as
 $$ select (created->>'exportId')::uuid from ex where label=p_label $$;
create function pg_temp.envelope(p_label text,p_op text) returns jsonb language sql stable as $$
 select jsonb_build_object('routeId',case kind when 'record' then 'api.subject-export' else 'api.export' end,'origin','authenticated',
  'principalId',capture->>'principalId','targetKind',case kind when 'record' then 'subject' else 'account' end,'targetId',target,
  'exportContract',case kind when 'record' then 'subject-export-v1' else 'account-export-v1' end,'originBinding',capture->>'originBinding',
  'authorityReceipt',capture->>'authorityReceipt','csrfBinding',repeat('c',64),'operation',p_op,'nonceHash',pg_temp.h(p_op||'-'||p_label),
  'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
  'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)
  ||case when p_op='open-ready' then jsonb_build_object('exportId',created->>'exportId','exportRevision',(created->>'exportRevision')::bigint)
   else '{}'::jsonb end from ex where label=p_label;
$$;
create function pg_temp.request(p_label text,p_op text,p_payload jsonb default null,p_csrf text default null) returns jsonb language sql volatile as
 $$ select case kind when 'record' then public.subject_export_request_v1(p_op,pg_temp.origin(p_label),target,p_payload,p_csrf)
   else public.export_archive_request_v1(p_op,pg_temp.origin(p_label),'account',target,p_payload,p_csrf) end from ex where label=p_label $$;
create function pg_temp.open(p_label text) returns jsonb language sql volatile as
 $$ select pg_temp.request(p_label,'open-ready',jsonb_build_object('exportId',pg_temp.export_id(p_label),'exportCookieHash',cookie,
   'envelope',pg_temp.envelope(p_label,'open-ready'),'downloadCookieHash',repeat('7',64)),repeat('c',64)) from ex where label=p_label $$;
create function pg_temp.worker(p_label text,p_op text,p_payload jsonb default null) returns jsonb language sql volatile as
 $$ select public.export_archive_worker_v1(p_op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',p_payload) from ex where label=p_label $$;
create function pg_temp.segment(p_label text) returns jsonb language sql stable as
 $$ select jsonb_build_object('ordinal',0,'offset',0,'sizeBytes',3,'sha256',repeat('d',64),
  'objectKey',(capture->>'principalHash')||'/'||(created->>'exportId')||'/'||attempt::text||'-0.part') from ex where label=p_label $$;
-- 'queued', 'writing' (an object reserved, a worker writing it), 'bytes'
-- (every byte written and recorded, not yet published) or 'ready' (TEST READY).
create function pg_temp.make_export(p_label text,p_stage text) returns void language plpgsql as $$
declare x ex;
begin
 update ex set capture=pg_temp.request(p_label,'capture') where label=p_label;
 update ex set created=pg_temp.request(p_label,'create',jsonb_build_object('envelope',pg_temp.envelope(p_label,'create'),
  'exportCookieHash',cookie),repeat('c',64)) where label=p_label;
 if p_stage='queued' then return; end if;
 perform pg_temp.worker(p_label,'begin');
 perform pg_temp.worker(p_label,'reserve',pg_temp.segment(p_label));
 update ex set frame=private.reserve_account_archive_r2_write_v1(attempt,0,capture->>'authorityReceipt',repeat('1',64)) where label=p_label;
 if p_stage='writing' then return; end if;
 select * into x from ex where label=p_label;
 perform private.complete_account_archive_r2_write_v1(x.attempt,0,x.capture->>'authorityReceipt',repeat('1',64),x.frame,'version1','etag1');
 perform pg_temp.worker(p_label,'acknowledge',pg_temp.segment(p_label)||jsonb_build_object('objectId',x.frame->>'objectId'));
 perform pg_temp.worker(p_label,'page',jsonb_build_object('page',0,'segments',
  jsonb_build_array(pg_temp.segment(p_label)||jsonb_build_object('objectId',x.frame->>'objectId'))));
 perform pg_temp.worker(p_label,'bytes-complete',jsonb_build_object('sizeBytes',3,'segmentCount',1,'pageCount',1,'sha256',repeat('d',64),
  'manifestSha256',encode(extensions.digest(convert_to(format('[0,0,3,%s,%s,%s]%s',to_json(repeat('d',64))::text,
   to_json(pg_temp.segment(p_label)->>'objectKey')::text,to_json(x.frame->>'objectId')::text,chr(10)),'UTF8'),'sha256'),'hex')));
 if p_stage='bytes' then return; end if;
 update ex set ready=private.complete_test_account_archive_v1(attempt,capture->>'authorityReceipt',
  jsonb_build_object('version','complete-account-zip64-producer-v1','memberCount',2,'payloadBytes',1,
   'memberSha256',repeat('e',64),'manifestMemberSha256',repeat('f',64))) where label=p_label;
end $$;
create function pg_temp.status(p_label text) returns text language sql stable as
 $$ select status from public.generated_exports where id=pg_temp.export_id(p_label) $$;
create function pg_temp.attempt_state(p_label text) returns text language sql stable as
 $$ select a.state from private.export_archive_attempts a join ex on ex.attempt=a.id where ex.label=p_label $$;
create function pg_temp.current(p_label text) returns boolean language plpgsql volatile as $$
begin
 perform private.export_archive_current_v1(pg_temp.export_id(p_label),(select capture->>'authorityReceipt' from ex where label=p_label));
 return true;
exception when insufficient_privilege then return false;
end $$;
-- Runs the withdrawal as the route's service role and keeps its answer.
create temporary table withdrawn(label text primary key,body jsonb);
grant select,insert on withdrawn to service_role;
create function pg_temp.withdraw_as_route(p_label text) returns void language plpgsql as $$
begin
 perform set_config('inherit.legal_audit_actor','',true);
 set local role service_role;
 insert into withdrawn select p_label,pg_temp.withdraw(p_label);
 reset role;
end $$;

-- A READY whole-account copy, opened and mid-download -------------------------------
savepoint ready_case;
select pg_temp.make_export('account-ready','ready');
update ex set download=(pg_temp.open('account-ready')->>'downloadSessionId')::uuid where label='account-ready';
select ok(private.issue_account_archive_test_chunk_v1((select download from ex where label='account-ready'),repeat('7',64),
  pg_temp.origin('account-ready'),0,repeat('3',64),repeat('d',64),3),'fixture: a READY whole-account copy is opened and its first chunk issued');
select ok(pg_temp.status('account-ready')='ready' and (select subject_partitions @> jsonb_build_array(alpha_subject) from public.generated_exports, fx
  where id=pg_temp.export_id('account-ready')),'fixture: its parts include the record');
-- Synthetic: a download session of the public table bound to the copy, in
-- the legacy form nothing makes for an archive any more. Its object is a
-- third account's source, so only the export binding can revoke it.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('7d152000-0000-4000-8000-000000000103','d152-withdrawal-gamma@example.invalid',clock_timestamp(),'{}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
select '7d152000-0000-4000-8000-000000000132','7d152000-0000-4000-8000-000000000103',id,'7d152000-0000-4000-8000-000000000135',
 'synthetic-gamma.txt','array_ancestry',1,1,'annotated' from public.subjects
 where subject_account_id='7d152000-0000-4000-8000-000000000103' and subject_class='self';
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
values('7d152000-0000-4000-8000-000000000133','7d152000-0000-4000-8000-000000000135','genomes','7d152000-0000-4000-8000-000000000132',
 repeat('a',64),1,1,'current');
insert into public.download_sessions(id,account_id,auth_session_id,principal_id,target_kind,target_id,purpose,object_id,
 lifecycle_revision,publication_revision,authorization_fingerprint,max_bytes,expires_at)
select '7d152000-0000-4000-8000-000000000134',alpha,alpha_session,(select (capture->>'principalId')::uuid from ex where label='account-ready'),
 'export',pg_temp.export_id('account-ready'),'raw.export','7d152000-0000-4000-8000-000000000133',1,1,repeat('a',64),3,
 clock_timestamp()+interval '1 hour' from fx;
-- The record's own READY copy, and another person's two READY copies.
select pg_temp.make_export('record-ready','ready');
select pg_temp.make_export('beta-account','ready');
select pg_temp.make_export('beta-record','ready');
select ok(pg_temp.current('account-ready') and pg_temp.current('record-ready') and pg_temp.current('beta-account') and pg_temp.current('beta-record'),
 'fixture: all four copies are current');
select lives_ok($$select pg_temp.withdraw_as_route('ready')$$,'the person withdraws consent for their own file');
select is((select body from withdrawn where label='ready'),jsonb_build_object('case','self','files',jsonb_build_array((select file from fx))),
 'and the withdrawal answers as the self case does, with the record''s file to drain');
select is(pg_temp.status('account-ready')||' '||pg_temp.attempt_state('account-ready'),'revoked cleanup_pending',
 'the READY whole-account copy is ended: revoked, its attempt stopped');
select ok((select completed_at is null and expires_at is null from public.generated_exports where id=pg_temp.export_id('account-ready')),
 'and it no longer carries a completion');
select ok((select cleanup_not_before=lease_expires_at+interval '30 seconds' from private.export_archive_attempts
  where id=(select attempt from ex where label='account-ready')),'its objects wait for disposal behind the attempt''s own fence');
select ok((select written_at is not null and disposal_claim is null and disposed_at is null from private.account_archive_r2_allocations
  where attempt_id=(select attempt from ex where label='account-ready')),'nothing is deleted early: its stored object is kept for the disposal runner');
select throws_ok($$select private.export_archive_current_v1(pg_temp.export_id('account-ready'),(select capture->>'authorityReceipt' from ex where label='account-ready'))$$,
 '42501','not_found','it fails the currentness check every poll, open and chunk read runs');
select ok((select revoked_at is not null from private.export_archive_downloads where id=(select download from ex where label='account-ready')),
 'its open download is revoked');
select throws_ok($$select private.account_archive_test_delivery_context_v1((select download from ex where label='account-ready'),repeat('7',64),
  pg_temp.origin('account-ready'))$$,'42501',null,'the open download serves nothing more');
select throws_ok($$select private.ack_account_archive_test_chunk_v1((select download from ex where label='account-ready'),repeat('7',64),
  pg_temp.origin('account-ready'),0,repeat('3',64),repeat('d',64),3)$$,'42501',null,'the chunk in flight cannot be acknowledged');
select throws_ok($$select private.issue_account_archive_test_chunk_v1((select download from ex where label='account-ready'),repeat('7',64),
  pg_temp.origin('account-ready'),1,repeat('4',64),repeat('d',64),3)$$,'42501',null,'and no further chunk is issued');
select throws_ok($$select pg_temp.open('account-ready')$$,'55000','export_source_unavailable',
 'nor can it be opened again while the file awaits its finish');
select is((select status from public.download_sessions where id='7d152000-0000-4000-8000-000000000134'),'revoked',
 'a public download session bound to it is revoked');
select is(pg_temp.status('record-ready')||' '||pg_temp.attempt_state('record-ready'),'revoked cleanup_pending',
 'the record''s own READY copy ends as before (D-144)');
select ok(pg_temp.status('beta-account')='ready' and pg_temp.attempt_state('beta-account')='bytes_complete' and pg_temp.current('beta-account'),
 'another person''s READY whole-account copy is not touched');
select ok(pg_temp.status('beta-record')='ready' and pg_temp.current('beta-record'),'nor their READY record copy');
select is((select count(*) from public.legal_audit_log where event_code='subject.emptied' and route_id='api.subject-delete'
  and audit_principal_id=(select audit_principal_id from private.legal_audit_account_principals where account_id=(select alpha from fx))),1::bigint,
 'the emptying''s one audit event is written');
-- The route then removes the bytes and finishes the file; the guard, which
-- every finish runs again, finds no live copy of the record.
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where bucket_id='genomes' and name='77900000-0000-4000-8000-000000000030';
select set_config('storage.allow_delete_query','false',true);
select lives_ok($$select public.finish_genome_file_deletion_v1((select alpha from fx),(select alpha_session from fx),(select file from fx),
  (select token from private.genome_file_deletions where file_id=(select file from fx)))$$,'the file is finished, as the route drains it');
select throws_ok($$select pg_temp.request('account-ready','check',jsonb_build_object('exportId',pg_temp.export_id('account-ready'),
  'exportCookieHash',repeat('4',64)))$$,'42501','not_found','and polling the whole-account copy afterwards finds nothing');
rollback to ready_case;

-- Each state of a whole-account copy that includes the record ------------------------
savepoint account_queued;
select pg_temp.make_export('account-queued','queued');
select lives_ok($$select pg_temp.withdraw_as_route('queued')$$,'the withdrawal runs with a queued whole-account copy');
select is(pg_temp.status('account-queued'),'revoked','a queued whole-account copy is revoked, as before');
select throws_ok($$select pg_temp.worker('account-queued','preflight')$$,'42501','not_found','and no worker begins it');
rollback to account_queued;

savepoint account_writing;
select pg_temp.make_export('account-writing','writing');
select lives_ok($$select pg_temp.withdraw_as_route('writing')$$,'the withdrawal runs while a worker writes a whole-account copy');
select is(pg_temp.status('account-writing')||' '||pg_temp.attempt_state('account-writing'),'revoked cleanup_pending',
 'the copy being built is revoked and its attempt stopped, as D-151 stops one');
select throws_ok($$select private.complete_account_archive_r2_write_v1((select attempt from ex where label='account-writing'),0,
  (select capture->>'authorityReceipt' from ex where label='account-writing'),repeat('1',64),(select frame from ex where label='account-writing'),'version1','etag1')$$,
 '42501',null,'the worker''s write in flight can no longer be recorded');
select throws_ok($$select private.claim_account_archive_r2_disposal_v1((select attempt from ex where label='account-writing'),0,repeat('4',64))$$,
 '42501','account_archive_r2_unavailable','and its object is not disposed of before the fence passes');
rollback to account_writing;

savepoint account_bytes;
select pg_temp.make_export('account-bytes','bytes');
select lives_ok($$select pg_temp.withdraw_as_route('bytes')$$,'the withdrawal runs with a whole-account copy written but not yet published');
select is(pg_temp.status('account-bytes')||' '||pg_temp.attempt_state('account-bytes'),'revoked cleanup_pending',
 'it is revoked and its attempt stopped, so it can never be published');
rollback to account_bytes;

-- Synthetic: a READY copy whose expiry has passed before its deadline (the
-- write-once completion and the row move together, guard triggers set aside).
savepoint account_expired;
select pg_temp.make_export('account-expired','ready');
set local session_replication_role=replica;
update private.export_archive_attempts set account_r2_completion=jsonb_set(account_r2_completion,'{expiresAt}',
 to_jsonb((select requested_at+interval '1 millisecond' from public.generated_exports where id=pg_temp.export_id('account-expired'))))
 where id=(select attempt from ex where label='account-expired');
update public.generated_exports set expires_at=requested_at+interval '1 millisecond' where id=pg_temp.export_id('account-expired');
set local session_replication_role=origin;
select lives_ok($$select pg_temp.withdraw_as_route('expired')$$,'the withdrawal runs with a READY whole-account copy past its expiry');
select is(pg_temp.status('account-expired')||' '||pg_temp.attempt_state('account-expired'),'revoked cleanup_pending',
 'it ends too, its objects queued without waiting for the sweep');
rollback to account_expired;

savepoint account_failed;
select pg_temp.make_export('account-failed','writing');
select public.export_archive_cleanup_v1('stop',pg_temp.export_id('account-failed'),(select attempt from ex where label='account-failed'));
select lives_ok($$select pg_temp.withdraw_as_route('failed')$$,'the withdrawal runs with a failed whole-account copy');
select is(pg_temp.status('account-failed')||' '||pg_temp.attempt_state('account-failed'),'failed cleanup_pending',
 'a copy that already failed is not touched');
rollback to account_failed;

-- Synthetic: a status-only revocation that left the attempt writing.
savepoint account_revoked;
select pg_temp.make_export('account-revoked','writing');
update public.generated_exports set status='revoked' where id=pg_temp.export_id('account-revoked');
select lives_ok($$select pg_temp.withdraw_as_route('revoked')$$,'the withdrawal runs with an already revoked whole-account copy');
select is(pg_temp.status('account-revoked')||' '||pg_temp.attempt_state('account-revoked'),'revoked writing',
 'a copy already ended is not touched; the sweep stops its attempt when the lease lapses');
rollback to account_revoked;

-- Synthetic: a READY whole-account copy whose parts do not include the
-- record (every real one does; its parts are rewritten with the identity
-- guard set aside).
savepoint account_elsewhere;
select pg_temp.make_export('account-elsewhere','ready');
set local session_replication_role=replica;
update public.generated_exports set subject_partitions=jsonb_build_array('7d152000-0000-4000-8000-0000000001ff')
 where id=pg_temp.export_id('account-elsewhere');
set local session_replication_role=origin;
select lives_ok($$select pg_temp.withdraw_as_route('elsewhere')$$,'the withdrawal runs with a READY copy whose parts do not include the record');
select is(pg_temp.status('account-elsewhere')||' '||pg_temp.attempt_state('account-elsewhere'),'ready bytes_complete',
 'a copy that does not include the record is not touched');
rollback to account_elsewhere;

-- The body is the reviewed successor -------------------------------------------------
select is((select md5(pg_get_functiondef('private.empty_self_subject_v1(uuid,uuid)'::regprocedure))),'768b5433d639f9c8578fbd59a5a0d703',
 'the self emptying is the reviewed successor of 20261122130000 (D-152)');
select is((select proacl::text from pg_proc where oid='private.empty_self_subject_v1(uuid,uuid)'::regprocedure),'{postgres=X/postgres}',
 'and its grants are unchanged');

select * from finish();
rollback;
