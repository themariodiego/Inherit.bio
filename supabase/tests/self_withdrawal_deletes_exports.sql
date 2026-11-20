begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- D-144 (migration 20261120100000_self_withdrawal_deletes_exports): a saved
-- export of a person's own record no longer blocks the withdrawal of their
-- upload consent. The emptying ends every export of the record through the
-- export cleanup door's own stop and revokes it; the per-file guard and the
-- page's read follow. Every request, job, attempt, reservation, READY and
-- download here is made by the current doors; the rows that only time or
-- an earlier revocation would make (an aged job, a status-only revocation,
-- a legacy-form download session, an embryo call) are synthetic fixtures
-- named as such. The TEST R2 configuration is the transaction-local
-- synthetic one the export suites use; no provider is called. Everything
-- rolls back.
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
 ('7d144000-0000-4000-8000-000000000002','d144-beta@example.invalid',clock_timestamp(),'{}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('7d144000-0000-4000-8000-000000000012','7d144000-0000-4000-8000-000000000002',clock_timestamp(),clock_timestamp(),'aal1');

create temporary table fx as select
 '77900000-0000-4000-8000-000000000001'::uuid alpha,
 '77900000-0000-4000-8000-000000000010'::uuid alpha_session,
 (select id from normalization_subject) alpha_subject,
 '77900000-0000-4000-8000-000000000040'::uuid file,
 '7d144000-0000-4000-8000-000000000002'::uuid beta,
 '7d144000-0000-4000-8000-000000000012'::uuid beta_session,
 (select id from public.subjects where subject_account_id='7d144000-0000-4000-8000-000000000002' and subject_class='self') beta_subject;
grant select on fx to service_role;

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('self-withdrawal-exports-test:'||p,'sha256'),'hex') $$;
create function pg_temp.notice() returns jsonb language sql stable as
 $$ select jsonb_build_object('contactCiphertext',repeat('ab',40),'contactHmac',repeat('c',64),
  'contactRevision',(select mail_contact_revision from public.profiles where id=(select alpha from fx))) $$;
create function pg_temp.withdraw(p_code text) returns jsonb language sql volatile as
 $$ select public.empty_self_subject_with_notice_v1((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),
  pg_temp.h(p_code),clock_timestamp()+interval '5 minutes',pg_temp.notice()) $$;
create function pg_temp.ready() returns text language sql stable as
 $$ select public.self_subject_withdrawal_readiness_v1((select alpha from fx),(select alpha_subject from fx)) $$;

-- Exports, each through the subject export's doors. ex.label names the case.
create temporary table ex(label text primary key,account uuid,session uuid,subject uuid,attempt uuid,cookie text,
 capture jsonb,created jsonb,frame jsonb,ready jsonb);
insert into ex(label,account,session,subject,attempt,cookie)
select label,fx.alpha,fx.alpha_session,fx.alpha_subject,attempt::uuid,repeat(cookie,64) from fx,(values
 ('swept','7d144000-0000-4000-8000-0000000000a1','1'),('expired','7d144000-0000-4000-8000-0000000000a2','2'),
 ('revoked','7d144000-0000-4000-8000-0000000000a3','3'),('ready','7d144000-0000-4000-8000-0000000000a4','4'),
 ('building','7d144000-0000-4000-8000-0000000000a5','5'),('queued','7d144000-0000-4000-8000-0000000000a7','8')) x(label,attempt,cookie)
union all select 'beta',beta,beta_session,beta_subject,'7d144000-0000-4000-8000-0000000000a6',repeat('6',64) from fx;
grant select on ex to service_role;
create function pg_temp.origin(p_label text) returns jsonb language sql stable as
 $$ select jsonb_build_object('kind','account','accountId',account,'sessionId',session) from ex where label=p_label $$;
create function pg_temp.export_id(p_label text) returns uuid language sql stable as
 $$ select (created->>'exportId')::uuid from ex where label=p_label $$;
create function pg_temp.envelope(p_label text,p_op text) returns jsonb language sql stable as $$
 select jsonb_build_object('routeId','api.subject-export','origin','authenticated','principalId',capture->>'principalId',
  'targetKind','subject','targetId',subject,'exportContract','subject-export-v1','originBinding',capture->>'originBinding',
  'authorityReceipt',capture->>'authorityReceipt','csrfBinding',repeat('c',64),'operation',p_op,'nonceHash',pg_temp.h(p_op||'-'||p_label),
  'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
  'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)
  ||case when p_op='open-ready' then jsonb_build_object('exportId',created->>'exportId','exportRevision',(created->>'exportRevision')::bigint)
   else '{}'::jsonb end from ex where label=p_label;
$$;
create function pg_temp.worker(p_label text,p_op text,p_payload jsonb default null) returns jsonb language sql volatile as
 $$ select public.export_archive_worker_v1(p_op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',p_payload) from ex where label=p_label $$;
create function pg_temp.segment(p_label text) returns jsonb language sql stable as
 $$ select jsonb_build_object('ordinal',0,'offset',0,'sizeBytes',3,'sha256',repeat('d',64),
  'objectKey',(capture->>'principalHash')||'/'||(created->>'exportId')||'/'||attempt::text||'-0.part') from ex where label=p_label $$;
-- 'queued', 'reserved' (an object reserved, a worker writing it), 'written'
-- (one object written and acknowledged) or 'ready' (TEST READY).
create function pg_temp.make_export(p_label text,p_stage text) returns void language plpgsql as $$
declare x ex;
begin
 update ex set capture=public.subject_export_request_v1('capture',pg_temp.origin(p_label),subject) where label=p_label;
 update ex set created=public.subject_export_request_v1('create',pg_temp.origin(p_label),subject,
  jsonb_build_object('envelope',pg_temp.envelope(p_label,'create'),'exportCookieHash',cookie),repeat('c',64)) where label=p_label;
 if p_stage='queued' then return; end if;
 perform pg_temp.worker(p_label,'begin');
 perform pg_temp.worker(p_label,'reserve',pg_temp.segment(p_label));
 update ex set frame=private.reserve_account_archive_r2_write_v1(attempt,0,capture->>'authorityReceipt',repeat('1',64)) where label=p_label;
 if p_stage='reserved' then return; end if;
 select * into x from ex where label=p_label;
 perform private.complete_account_archive_r2_write_v1(x.attempt,0,x.capture->>'authorityReceipt',repeat('1',64),x.frame,'version1','etag1');
 perform pg_temp.worker(p_label,'acknowledge',pg_temp.segment(p_label)||jsonb_build_object('objectId',x.frame->>'objectId'));
 if p_stage='written' then return; end if;
 perform pg_temp.worker(p_label,'page',jsonb_build_object('page',0,'segments',
  jsonb_build_array(pg_temp.segment(p_label)||jsonb_build_object('objectId',x.frame->>'objectId'))));
 perform pg_temp.worker(p_label,'bytes-complete',jsonb_build_object('sizeBytes',3,'segmentCount',1,'pageCount',1,'sha256',repeat('d',64),
  'manifestSha256',encode(extensions.digest(convert_to(format('[0,0,3,%s,%s,%s]%s',to_json(repeat('d',64))::text,
   to_json(pg_temp.segment(p_label)->>'objectKey')::text,to_json(x.frame->>'objectId')::text,chr(10)),'UTF8'),'sha256'),'hex')));
 update ex set ready=private.complete_test_account_archive_v1(attempt,capture->>'authorityReceipt',
  jsonb_build_object('version','complete-account-zip64-producer-v1','memberCount',2,'payloadBytes',1,
   'memberSha256',repeat('e',64),'manifestMemberSha256',repeat('f',64))) where label=p_label;
end $$;
-- Synthetic: the export's 24 hours pass. Its job's clock moves into the
-- past (the export row's own request time is immutable), so the doors
-- refuse it as expired and the cleanup sweep finds it due.
create function pg_temp.age(p_label text) returns void language sql volatile as
 $$ update private.export_archive_jobs set created_at=statement_timestamp()-interval '25 hours',deadline=statement_timestamp()-interval '1 hour'
  where export_id=pg_temp.export_id(p_label) $$;
-- Where every attempt, job, download and reservation of the record's
-- exports stands: the state a stop writes, its fence, and what the
-- disposal runner reads. No clock value but the fence, which a stop
-- computes from the attempt's own lease.
create function pg_temp.queue_state() returns jsonb language sql stable as $$
 select jsonb_build_object(
  'attempts',(select jsonb_agg(jsonb_build_object('id',a.id,'state',a.state,'stopped',a.stopped_at is not null,
    'notBefore',a.cleanup_not_before) order by a.id) from private.export_archive_attempts a
   join public.generated_exports e on e.id=a.export_id where e.target_kind='subject' and e.target_id=(select alpha_subject from fx)),
  'jobs',(select jsonb_agg(jsonb_build_object('export',j.export_id,'active',j.active_attempt) order by j.export_id)
   from private.export_archive_jobs j join public.generated_exports e on e.id=j.export_id
   where e.target_kind='subject' and e.target_id=(select alpha_subject from fx)),
  'downloads',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'revoked',d.revoked_at is not null) order by d.id),'[]')
   from private.export_archive_downloads d join public.generated_exports e on e.id=d.export_id
   where e.target_kind='subject' and e.target_id=(select alpha_subject from fx)),
  'reservations',(select jsonb_agg(jsonb_build_object('attempt',r.attempt_id,'ordinal',r.ordinal,'written',r.written_at is not null,
    'claim',r.disposal_claim,'disposed',r.disposed_at) order by r.attempt_id,r.ordinal) from private.account_archive_r2_allocations r
   join private.export_archive_attempts a on a.id=r.attempt_id join public.generated_exports e on e.id=a.export_id
   where e.target_kind='subject' and e.target_id=(select alpha_subject from fx)),
  'completion',(select jsonb_agg(jsonb_build_object('export',e.id,'completed',e.completed_at,'expires',e.expires_at) order by e.id)
   from public.generated_exports e where e.target_kind='subject' and e.target_id=(select alpha_subject from fx)));
$$;
create function pg_temp.status(p_label text) returns text language sql stable as
 $$ select status from public.generated_exports where id=pg_temp.export_id(p_label) $$;
create function pg_temp.attempt_state(p_label text) returns text language sql stable as
 $$ select a.state from private.export_archive_attempts a join ex on ex.attempt=a.id where ex.label=p_label $$;

-- The record's export history -----------------------------------------------------
-- An export that expired and that the cleanup sweep has already stopped.
select pg_temp.make_export('swept','ready');
select is(pg_temp.status('swept'),'ready','fixture: an export made READY through the doors');
select pg_temp.age('swept');
select ok(exists(select 1 from jsonb_array_elements(private.account_archive_test_cleanup_due_v1()) v
  where v->>'attemptId'=(select attempt::text from ex where label='swept')),'fixture: once expired, the cleanup sweep finds it due');
select is(public.export_archive_cleanup_v1('stop',pg_temp.export_id('swept'),(select attempt from ex where label='swept'))->>'state',
 'cleanup-pending','fixture: and stops it through the cleanup door, as the disposal runner does');
-- An export that expired and that the sweep has not reached yet.
select pg_temp.make_export('expired','ready');
select pg_temp.age('expired');
-- An export revoked while it was being built, by a revocation that leaves
-- the attempt to the sweep (synthetic: the status-only revocation the subject
-- transfer and the emptying's account-level revocation write).
select pg_temp.make_export('revoked','written');
update public.generated_exports set status='revoked' where id=pg_temp.export_id('revoked');
-- Another person's record has an export of its own.
select pg_temp.make_export('beta','queued');
select is((select array_agg(pg_temp.status(label)||' '||pg_temp.attempt_state(label) order by label) from ex
  where label in ('swept','expired','revoked')),array['ready bytes_complete','revoked writing','failed cleanup_pending'],
 'fixture: the record holds an expired, a revoked and an already-swept export, two of them still holding their objects');
select throws_ok($$select public.subject_export_request_v1('check',pg_temp.origin('expired'),(select alpha_subject from fx),
  jsonb_build_object('exportId',pg_temp.export_id('expired'),'exportCookieHash',repeat('2',64)))$$,'42501','not_found',
 'fixture: the expired export is no longer reachable by its link');

-- The page's read ---------------------------------------------------------------------
select is(pg_temp.ready(),'ready','a record whose only obstacle was its exports reads ready');

-- The per-file guard, shared with api.file-delete -----------------------------------
-- api.file-delete is unchanged on a record that has not been emptied: any
-- export of it still blocks deleting one file, as the register's
-- file-delete-v1 says. Only an export the emptying retired stops counting.
savepoint file_shortcut;
select throws_ok($$select public.prepare_genome_file_deletion_v1((select alpha from fx),(select alpha_session from fx),(select file from fx))$$,
 '55000','file_delete_shared_graph','one file still cannot be deleted alone while the record has exports');
select public.export_archive_cleanup_v1('stop',pg_temp.export_id('expired'),(select attempt from ex where label='expired'));
select public.export_archive_cleanup_v1('stop',pg_temp.export_id('revoked'),(select attempt from ex where label='revoked'));
select is((select count(*) from private.export_archive_attempts a join public.generated_exports e on e.id=a.export_id
  where e.target_kind='subject' and e.target_id=(select alpha_subject from fx) and a.state in ('writing','bytes_complete')),0::bigint,
 'fixture: the sweep has stopped every export of the record, so none holds objects not queued');
select throws_ok($$select public.prepare_genome_file_deletion_v1((select alpha from fx),(select alpha_session from fx),(select file from fx))$$,
 '55000','file_delete_shared_graph','nor once the sweep has stopped them: an expired or failed export still blocks it, as before');
update public.generated_exports set status='revoked' where id=pg_temp.export_id('swept');
select throws_ok($$select public.prepare_genome_file_deletion_v1((select alpha from fx),(select alpha_session from fx),(select file from fx))$$,
 '55000','file_delete_shared_graph','while any export of the record is not revoked, it still blocks');
update public.generated_exports set status='revoked' where target_kind='subject' and target_id=(select alpha_subject from fx);
select lives_ok($$select public.prepare_genome_file_deletion_v1((select alpha from fx),(select alpha_session from fx),(select file from fx))$$,
 'an export revoked with nothing left to queue, as the emptying leaves every one, no longer holds the file');
rollback to file_shortcut;

-- The two other refusals stand -----------------------------------------------------
savepoint foreign_file;
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
select '7d144000-0000-4000-8000-000000000031',beta,alpha_subject,beta::text||'/synthetic-foreign','synthetic-foreign.txt','array_ancestry',1,1,'annotated' from fx;
select is(pg_temp.ready(),'unsupported','a file another account holds on the record still reads unsupported');
select throws_ok($$select pg_temp.withdraw('foreign')$$,'55000','subject_delete_unsupported_graph',
 'and the emptying still refuses it');
rollback to foreign_file;
savepoint embryo_file;
-- Synthetic: a call of an embryo record made from the record's file. Only
-- the reference matters here, so the embryo row is not built.
set local session_replication_role=replica;
insert into public.embryo_variants(embryo_id,source_file_id,chromosome,position,genotype,source_binding_fingerprint)
select '7d144000-0000-4000-8000-000000000041',file,1,100,'A/G',repeat('a',64) from fx;
set local session_replication_role=origin;
select is(pg_temp.ready(),'unsupported','a file tied to embryo records still reads unsupported');
select throws_ok($$select pg_temp.withdraw('embryo')$$,'55000','subject_delete_unsupported_graph',
 'and the emptying still refuses it');
rollback to embryo_file;
select ok((select array_agg(pg_temp.status(label)||' '||pg_temp.attempt_state(label) order by label) from ex
  where label in ('swept','expired','revoked'))=array['ready bytes_complete','revoked writing','failed cleanup_pending']
 and (select count(*) from public.account_operation_nonces where account_id=(select alpha from fx) and operation='subject_delete')=0,
 'a refused withdrawal touches no export and records no code');

-- Case 1: a READY export with an open download --------------------------------------
savepoint ready_case;
select pg_temp.make_export('ready','ready');
select is((select ready->>'status' from ex where label='ready'),'ready','fixture: a live export is READY');
create temporary table ready_download as select (public.subject_export_request_v1('open-ready',pg_temp.origin('ready'),(select alpha_subject from fx),
 jsonb_build_object('exportId',pg_temp.export_id('ready'),'exportCookieHash',repeat('4',64),'envelope',pg_temp.envelope('ready','open-ready'),
  'downloadCookieHash',repeat('7',64)),repeat('c',64))->>'downloadSessionId')::uuid id;
select ok((private.account_archive_test_delivery_context_v1((select id from ready_download),repeat('7',64),pg_temp.origin('ready'))->'ready')
  =(select ready from ex where label='ready'),'fixture: its download link works');
select ok(private.issue_account_archive_test_chunk_v1((select id from ready_download),repeat('7',64),pg_temp.origin('ready'),0,repeat('3',64),repeat('d',64),3),
 'fixture: and a chunk of it is being read');
-- Synthetic: a download session of the public table bound to the export, in
-- the legacy form nothing makes for an archive any more. Its object is Beta's
-- source, so only the export binding can revoke it.
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
select '7d144000-0000-4000-8000-000000000032',beta,beta_subject,'7d144000-0000-4000-8000-000000000035','synthetic-beta.txt','array_ancestry',1,1,'annotated' from fx;
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
values('7d144000-0000-4000-8000-000000000033','7d144000-0000-4000-8000-000000000035','genomes','7d144000-0000-4000-8000-000000000032',
 repeat('a',64),1,1,'current');
insert into public.download_sessions(id,account_id,auth_session_id,principal_id,target_kind,target_id,purpose,object_id,
 lifecycle_revision,publication_revision,authorization_fingerprint,max_bytes,expires_at)
select '7d144000-0000-4000-8000-000000000034',alpha,alpha_session,(select (capture->>'principalId')::uuid from ex where label='ready'),
 'export',pg_temp.export_id('ready'),'raw.export','7d144000-0000-4000-8000-000000000033',1,1,repeat('a',64),3,
 clock_timestamp()+interval '1 hour' from fx;
select is(pg_temp.ready(),'ready','with a live export as well, the record reads ready');

-- What the cleanup door itself writes when it stops every attempt of the
-- record's exports that still holds or is writing objects. The psql
-- variable keeps it across the rollback.
savepoint door;
select count(public.export_archive_cleanup_v1('stop',a.export_id,a.id,null)) from private.export_archive_attempts a
 join public.generated_exports e on e.id=a.export_id where e.target_kind='subject' and e.target_id=(select alpha_subject from fx)
  and a.state in ('writing','bytes_complete');
select pg_temp.queue_state()::text as door_state \gset
rollback to door;

select set_config('inherit.legal_audit_actor','',true);
create temporary table withdrawn(body jsonb);
grant select,insert on withdrawn to service_role;
set local role service_role;
select lives_ok($$insert into withdrawn select pg_temp.withdraw('withdraw-ready')$$,
 'the withdrawal runs on a record with a READY, an expired, a revoked and an already-swept export');
reset role;
select is((select body from withdrawn),jsonb_build_object('case','self','files',jsonb_build_array((select file from fx))),
 'and answers as the self case does, with the record''s file to drain');
select is(pg_temp.queue_state(),:'door_state'::jsonb,
 'every attempt, job, download and reservation of the record''s exports is exactly where the cleanup door''s own stop leaves it');
select is((select count(*) from public.generated_exports where target_kind='subject' and target_id=(select alpha_subject from fx)
  and status in ('queued','building','ready')),0::bigint,'no export of the record is live');
select is((select array_agg(label||' '||pg_temp.status(label)||' '||pg_temp.attempt_state(label) order by label) from ex
  where label in ('swept','expired','revoked','ready')),
 array['expired revoked cleanup_pending','ready revoked cleanup_pending','revoked revoked cleanup_pending','swept revoked cleanup_pending'],
 'every export of the record is revoked, the READY, the expired, the revoked and the already-swept one, with its objects queued');
select ok((select completed_at is null and expires_at is null from public.generated_exports where id=pg_temp.export_id('ready')),
 'the revoked READY export no longer carries a completion');
select is((select count(*) from private.export_archive_attempts a join public.generated_exports e on e.id=a.export_id
  where e.target_kind='subject' and e.target_id=(select alpha_subject from fx)
   and (a.state not in ('cleanup_pending','cleaned') or a.cleanup_not_before<>a.lease_expires_at+interval '30 seconds')),0::bigint,
 'each attempt waits for disposal behind its own write fence, the lease and thirty seconds');
select is((select count(*) from private.account_archive_r2_allocations r join private.export_archive_attempts a on a.id=r.attempt_id
  join public.generated_exports e on e.id=a.export_id where e.target_kind='subject' and e.target_id=(select alpha_subject from fx)
  and r.disposed_at is null and r.disposal_claim is null),4::bigint,
 'every stored object of the four exports is kept for the disposal runner, none disposed or claimed yet');
select is((select count(*) from public.generated_exports where target_kind='subject' and target_id=(select alpha_subject from fx)),4::bigint,
 'no export row is deleted: the export design keeps them');
select throws_ok($$select private.export_archive_current_v1(pg_temp.export_id('ready'),(select capture->>'authorityReceipt' from ex where label='ready'))$$,
 '42501','not_found','the READY export fails the currentness check every link, poll and chunk read runs');
select throws_ok($$select public.subject_export_request_v1('check',pg_temp.origin('ready'),(select alpha_subject from fx),
  jsonb_build_object('exportId',pg_temp.export_id('ready'),'exportCookieHash',repeat('4',64)))$$,'55000','export_source_unavailable',
 'polling its link is refused while the file awaits its finish (the route''s 409)');
select throws_ok($$select private.account_archive_test_delivery_context_v1((select id from ready_download),repeat('7',64),pg_temp.origin('ready'))$$,
 '42501',null,'its open download serves nothing more');
select ok((select revoked_at is not null from private.export_archive_downloads where id=(select id from ready_download)),
 'and is revoked');
select is((select status from public.download_sessions where id='7d144000-0000-4000-8000-000000000034'),'revoked',
 'a public download session bound to the export is revoked');
select is(pg_temp.status('beta'),'queued','another person''s export is untouched');
select is((select count(*) from private.genome_file_deletions where file_id=(select file from fx)),1::bigint,
 'the record''s file is prepared for deletion');
select is((select count(*) from public.legal_audit_log where event_code='subject.emptied' and route_id='api.subject-delete'
  and audit_principal_id=(select audit_principal_id from private.legal_audit_account_principals where account_id=(select alpha from fx))),1::bigint,
 'the emptying''s audit event is written and names the account that asked');
select is((select count(*) from public.mail_outbox where template_id='upload-consent-withdrawn' and target_id=(select alpha_subject from fx)
  and state='queued'),1::bigint,'the confirmation email is queued');
select ok((select bool_and(revoked_at is not null) from public.subject_consents where subject_id=(select alpha_subject from fx)),
 'the upload consent and every consent on the record are withdrawn');
select is(pg_temp.ready(),'ready','the emptied record reads ready again');
-- The route then removes the bytes and finishes the file through the shared
-- guard, which every finish runs again.
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where bucket_id='genomes' and name='77900000-0000-4000-8000-000000000030';
select set_config('storage.allow_delete_query','false',true);
select lives_ok($$select public.finish_genome_file_deletion_v1((select alpha from fx),(select alpha_session from fx),(select file from fx),
  (select token from private.genome_file_deletions where file_id=(select file from fx)))$$,
 'the prepared file is finished, as the route drains it: no export of the record holds it any longer');
select is((select count(*) from public.genome_files where id=(select file from fx)),0::bigint,'and the file is gone');
select throws_ok($$select public.subject_export_request_v1('check',pg_temp.origin('ready'),(select alpha_subject from fx),
  jsonb_build_object('exportId',pg_temp.export_id('ready'),'exportCookieHash',repeat('4',64)))$$,'42501','not_found',
 'and polling the link afterwards finds nothing (the route''s 404)');
rollback to ready_case;

-- Case 2: an export being built --------------------------------------------------------
savepoint building_case;
select pg_temp.make_export('building','reserved');
select ok(pg_temp.status('building')='building' and pg_temp.attempt_state('building')='writing'
 and (select written_at is null from private.account_archive_r2_allocations where attempt_id=(select attempt from ex where label='building')),
 'fixture: a worker is building an export and has reserved an object it is writing');
select is(pg_temp.ready(),'ready','a record with an export being built reads ready');
savepoint door;
select count(public.export_archive_cleanup_v1('stop',a.export_id,a.id,null)) from private.export_archive_attempts a
 join public.generated_exports e on e.id=a.export_id where e.target_kind='subject' and e.target_id=(select alpha_subject from fx)
  and a.state in ('writing','bytes_complete');
select pg_temp.queue_state()::text as door_state \gset
rollback to door;
select set_config('inherit.legal_audit_actor','',true);
create temporary table withdrawn_building(body jsonb);
grant select,insert on withdrawn_building to service_role;
set local role service_role;
select lives_ok($$insert into withdrawn_building select pg_temp.withdraw('withdraw-building')$$,
 'the withdrawal runs while a worker is building an export of the record');
reset role;
select is((select body->>'case' from withdrawn_building),'self','and answers as the self case does');
select is(pg_temp.queue_state(),:'door_state'::jsonb,
 'every attempt, job and reservation is exactly where the cleanup door''s own stop leaves it');
select is(pg_temp.status('building')||' '||pg_temp.attempt_state('building'),'revoked cleanup_pending',
 'the export being built is revoked and its attempt stopped');
select ok((select cleanup_not_before>clock_timestamp() from private.export_archive_attempts where id=(select attempt from ex where label='building')),
 'its reserved object waits behind the running write''s fence');
select throws_ok($$select private.complete_account_archive_r2_write_v1((select attempt from ex where label='building'),0,
  (select capture->>'authorityReceipt' from ex where label='building'),repeat('1',64),(select frame from ex where label='building'),'version1','etag1')$$,
 '42501',null,'the worker''s write in flight can no longer be recorded');
select throws_ok($$select pg_temp.worker('building','renew')$$,'42501','not_found','nor can the worker renew its lease');
select throws_ok($$select pg_temp.worker('building','begin')$$,'42501','not_found','nor begin a new attempt');
select throws_ok($$select private.claim_account_archive_r2_disposal_v1((select attempt from ex where label='building'),0,repeat('4',64))$$,
 '42501','account_archive_r2_unavailable','and its object is not disposed of before the fence passes');
select ok((select written_at is null and disposed_at is null from private.account_archive_r2_allocations
  where attempt_id=(select attempt from ex where label='building')),'the reservation stays for the disposal runner');
select is((select count(*) from public.legal_audit_log where event_code='subject.emptied' and route_id='api.subject-delete'
  and audit_principal_id=(select audit_principal_id from private.legal_audit_account_principals where account_id=(select alpha from fx))),1::bigint,
 'the audit event is written');
select is((select count(*) from public.mail_outbox where template_id='upload-consent-withdrawn' and target_id=(select alpha_subject from fx)),1::bigint,
 'the confirmation email is queued');
rollback to building_case;

-- Case 3: an export still waiting for a worker -------------------------------------
savepoint queued_case;
select pg_temp.make_export('queued','queued');
select is(pg_temp.status('queued'),'queued','fixture: an export is queued and no worker has begun it');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(exists(select 1 from jsonb_array_elements(public.export_archive_subject_due_v1()) v
  where v->>'exportId'=pg_temp.export_id('queued')::text),'fixture: the subject worker''s due reader lists it');
select lives_ok($$select pg_temp.withdraw('withdraw-queued')$$,'the withdrawal runs while an export of the record is queued');
reset role;
select is(pg_temp.status('queued'),'revoked','the queued export is revoked, so no worker ever begins it');
select throws_ok($$select pg_temp.worker('queued','preflight')$$,'42501','not_found','the worker''s preflight refuses it');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(not exists(select 1 from jsonb_array_elements(public.export_archive_subject_due_v1()) v
  where v->>'exportId'=pg_temp.export_id('queued')::text),'and the subject worker''s due reader no longer lists it');
reset role;
rollback to queued_case;

-- The bodies are the reviewed successors ---------------------------------------------
select is((select md5(pg_get_functiondef('private.empty_self_subject_v1(uuid,uuid)'::regprocedure))),'5c35b1a9eafbfe7fd3e16f54b648dee7',
 'the self emptying is the reviewed successor');
select is((select md5(pg_get_functiondef('private.prepare_genome_file_deletion_body_v1(uuid,uuid)'::regprocedure))),'c78d66691786e656a063b2dfe7b78a28',
 'the per-file guard is the reviewed successor');
select is((select md5(pg_get_functiondef('public.self_subject_withdrawal_readiness_v1(uuid,uuid)'::regprocedure))),'963586dade86d48a3f61d03b2403d41a',
 'the page''s read is the reviewed successor');
select is((select md5(pg_get_functiondef('public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)'::regprocedure))),'25fa3ce71b73fb0c371d1bb9af836bd7',
 'the cleanup door it calls is unchanged');
select ok(not has_function_privilege('service_role','private.empty_self_subject_v1(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.self_subject_withdrawal_readiness_v1(uuid,uuid)','execute')
 and has_function_privilege('service_role','public.self_subject_withdrawal_readiness_v1(uuid,uuid)','execute'),
 'the grants are unchanged');

select * from finish();
rollback;
