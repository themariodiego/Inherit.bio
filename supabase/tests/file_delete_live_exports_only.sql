begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- D-152, first half (migration 20261122130000_file_delete_live_exports_only;
-- owner decision of 22 November 2026, "Only a live download copy blocks
-- deleting a single file"): the per-file guard api.file-delete prepares and
-- finishes every file through refuses file_delete_shared_graph only while a
-- download copy of the record is live: still being made (queued or
-- building) or still downloadable (ready, before its expiry), each before
-- its job's deadline. An expired, failed or ended copy no longer blocks.
-- Every copy here is made, opened, stopped and read through the current
-- doors; the states only time or another door would make (24 hours
-- passing, an expiry passing before the deadline, a status-only revocation,
-- a claimant's copy, a legacy row, a copy placed while a deletion waits)
-- are synthetic fixtures named as such. The TEST R2 configuration is the
-- transaction-local synthetic one the export suites use; no provider is
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
 ('7d152000-0000-4000-8000-000000000002','d152-beta@example.invalid',clock_timestamp(),'{}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('7d152000-0000-4000-8000-000000000012','7d152000-0000-4000-8000-000000000002',clock_timestamp(),clock_timestamp(),'aal1');

create temporary table fx as select
 '77900000-0000-4000-8000-000000000001'::uuid alpha,
 '77900000-0000-4000-8000-000000000010'::uuid alpha_session,
 (select id from normalization_subject) alpha_subject,
 '77900000-0000-4000-8000-000000000040'::uuid file,
 '7d152000-0000-4000-8000-000000000002'::uuid beta,
 '7d152000-0000-4000-8000-000000000012'::uuid beta_session,
 (select id from public.subjects where subject_account_id='7d152000-0000-4000-8000-000000000002' and subject_class='self') beta_subject;
grant select on fx to service_role;

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('file-delete-live-exports-test:'||p,'sha256'),'hex') $$;
-- Deleting the one file, exactly as api.file-delete's first call prepares it.
create function pg_temp.delete_file() returns jsonb language sql volatile as
 $$ select public.prepare_genome_file_deletion_v1((select alpha from fx),(select alpha_session from fx),(select file from fx)) $$;

-- Copies, each through its own doors. ex.label names the case; a 'record'
-- copy is the record's own export (api.subject-export), an 'account' copy the
-- whole account's (api.export).
create temporary table ex(label text primary key,kind text,account uuid,session uuid,target uuid,attempt uuid,cookie text,
 capture jsonb,created jsonb,frame jsonb,ready jsonb,download uuid);
insert into ex(label,kind,account,session,target,attempt,cookie)
select label,kind,fx.alpha,fx.alpha_session,case kind when 'record' then fx.alpha_subject else fx.alpha end,attempt::uuid,repeat(cookie,64)
from fx,(values
 ('queued','record','7d152000-0000-4000-8000-0000000000a1','1'),('writing','record','7d152000-0000-4000-8000-0000000000a2','2'),
 ('bytes','record','7d152000-0000-4000-8000-0000000000a3','3'),('ready','record','7d152000-0000-4000-8000-0000000000a4','4'),
 ('expired','record','7d152000-0000-4000-8000-0000000000a5','5'),('aged-ready','record','7d152000-0000-4000-8000-0000000000a6','6'),
 ('aged-queued','record','7d152000-0000-4000-8000-0000000000a7','7'),('aged-writing','record','7d152000-0000-4000-8000-0000000000a8','8'),
 ('failed','record','7d152000-0000-4000-8000-0000000000a9','9'),('revoked','record','7d152000-0000-4000-8000-0000000000aa','a'),
 ('retired','record','7d152000-0000-4000-8000-0000000000ab','b'),('legacy-status','record','7d152000-0000-4000-8000-0000000000ac','c'),
 ('account-queued','account','7d152000-0000-4000-8000-0000000000ad','d'),('account-ready','account','7d152000-0000-4000-8000-0000000000ae','e'))
 x(label,kind,attempt,cookie)
union all select 'beta','record',beta,beta_session,beta_subject,'7d152000-0000-4000-8000-0000000000af',repeat('f',64) from fx;
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
-- The request door of the copy's route: the record's (api.subject-export) or the account's (api.export).
create function pg_temp.request(p_label text,p_op text,p_payload jsonb default null,p_csrf text default null) returns jsonb language sql volatile as
 $$ select case kind when 'record' then public.subject_export_request_v1(p_op,pg_temp.origin(p_label),target,p_payload,p_csrf)
   else public.export_archive_request_v1(p_op,pg_temp.origin(p_label),'account',target,p_payload,p_csrf) end from ex where label=p_label $$;
create function pg_temp.poll(p_label text) returns jsonb language sql volatile as
 $$ select pg_temp.request(p_label,'check',jsonb_build_object('exportId',pg_temp.export_id(p_label),'exportCookieHash',cookie)) from ex where label=p_label $$;
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
-- Synthetic: the copy's 24 hours pass. Its job's clock moves into the past
-- (the export row's own request time is immutable), as the export suites age one.
create function pg_temp.age(p_label text) returns void language sql volatile as
 $$ update private.export_archive_jobs set created_at=statement_timestamp()-interval '25 hours',deadline=statement_timestamp()-interval '1 hour'
  where export_id=pg_temp.export_id(p_label) $$;
-- Synthetic: a READY copy's expiry passes while its job's deadline is still
-- ahead (completion sets the expiry from the earliest object deadline, which
-- can come first). The completion proof carries the expiry the READY row must
-- match and both are write-once, so both are moved together with the guard
-- triggers set aside for the two statements; the row's request time stays.
create function pg_temp.expire(p_label text) returns void language plpgsql as $$
declare v_at timestamptz:=(select requested_at+interval '1 millisecond' from public.generated_exports where id=pg_temp.export_id(p_label));
begin
 set local session_replication_role=replica;
 update private.export_archive_attempts set account_r2_completion=jsonb_set(account_r2_completion,'{expiresAt}',to_jsonb(v_at))
  where id=(select attempt from ex where label=p_label);
 update public.generated_exports set expires_at=v_at where id=pg_temp.export_id(p_label);
 set local session_replication_role=origin;
end $$;
create function pg_temp.status(p_label text) returns text language sql stable as
 $$ select status from public.generated_exports where id=pg_temp.export_id(p_label) $$;
create function pg_temp.attempt_state(p_label text) returns text language sql stable as
 $$ select a.state from private.export_archive_attempts a join ex on ex.attempt=a.id where ex.label=p_label $$;
-- The live state of a copy, read from what its doors do: the currentness
-- check every step, poll, open and chunk read runs answers, and the copy
-- opens. Used to show each fixture is what its name says.
create function pg_temp.current(p_label text) returns boolean language plpgsql volatile as $$
begin
 perform private.export_archive_current_v1(pg_temp.export_id(p_label),(select capture->>'authorityReceipt' from ex where label=p_label));
 return true;
exception when insufficient_privilege then return false;
end $$;

-- The file can be deleted when the record has no copy ---------------------------------
savepoint no_copy;
select lives_ok($$select pg_temp.delete_file()$$,'with no copy of the record, its one file can be deleted alone');
rollback to no_copy;

-- Each live copy of the record still blocks deleting one file -------------------------
savepoint live_queued;
select pg_temp.make_export('queued','queued');
select ok(pg_temp.status('queued')='queued' and pg_temp.current('queued'),'fixture: a copy is queued for a worker and current');
select throws_ok($$select pg_temp.delete_file()$$,'55000','file_delete_shared_graph','a queued copy of the record blocks it');
rollback to live_queued;

savepoint live_writing;
select pg_temp.make_export('writing','writing');
select ok(pg_temp.status('writing')='building' and pg_temp.attempt_state('writing')='writing' and pg_temp.current('writing'),
 'fixture: a worker is building a copy and writing an object of it');
select throws_ok($$select pg_temp.delete_file()$$,'55000','file_delete_shared_graph','a copy being built blocks it');
rollback to live_writing;

savepoint live_bytes;
select pg_temp.make_export('bytes','bytes');
select ok(pg_temp.status('bytes')='building' and pg_temp.attempt_state('bytes')='bytes_complete' and pg_temp.current('bytes'),
 'fixture: every byte of a copy is written and it awaits publication');
select throws_ok($$select pg_temp.delete_file()$$,'55000','file_delete_shared_graph','a copy written but not yet published blocks it');
rollback to live_bytes;

savepoint live_ready;
select pg_temp.make_export('ready','ready');
update ex set download=(pg_temp.open('ready')->>'downloadSessionId')::uuid where label='ready';
select ok(pg_temp.status('ready')='ready' and (select expires_at>clock_timestamp() from public.generated_exports where id=pg_temp.export_id('ready'))
  and (private.account_archive_test_delivery_context_v1((select download from ex where label='ready'),repeat('7',64),pg_temp.origin('ready'))->'ready')
   =(select ready from ex where label='ready'),
 'fixture: a READY copy before its expiry, opened, its download serving');
select throws_ok($$select pg_temp.delete_file()$$,'55000','file_delete_shared_graph','a READY copy that can still be downloaded blocks it');
select is((select count(*) from private.genome_file_deletions where file_id=(select file from fx)),0::bigint,
 'and nothing is prepared: the file stays');
rollback to live_ready;

-- Each copy that is no longer live no longer blocks it ---------------------------------
-- Expired by time: a READY copy whose expiry passed before its deadline.
savepoint expired;
select pg_temp.make_export('expired','ready');
update ex set download=(pg_temp.open('expired')->>'downloadSessionId')::uuid where label='expired';
select pg_temp.expire('expired');
select ok((select status='ready' and expires_at<=clock_timestamp() from public.generated_exports where id=pg_temp.export_id('expired'))
  and (select deadline>clock_timestamp() from private.export_archive_jobs where export_id=pg_temp.export_id('expired')),
 'fixture: a READY copy past its expiry, its deadline still ahead');
select is(pg_temp.poll('expired')->>'status','ready','fixture: its poll still answers ready');
select throws_ok($$select pg_temp.open('expired')$$,'42501','not_found','but it no longer opens');
select throws_ok($$select private.account_archive_test_delivery_context_v1((select download from ex where label='expired'),repeat('7',64),pg_temp.origin('expired'))$$,
 '42501',null,'and a download opened before its expiry serves nothing more');
select lives_ok($$select pg_temp.delete_file()$$,'a READY copy past its expiry no longer blocks deleting the file');
rollback to expired;

-- Expired by time: the copy's 24 hours have passed (its job's deadline).
savepoint aged_ready;
select pg_temp.make_export('aged-ready','ready');
select pg_temp.age('aged-ready');
select ok(pg_temp.status('aged-ready')='ready' and not pg_temp.current('aged-ready'),
 'fixture: a READY copy whose 24 hours have passed is no longer current');
select throws_ok($$select pg_temp.open('aged-ready')$$,'42501','not_found','fixture: and does not open');
select lives_ok($$select pg_temp.delete_file()$$,'a READY copy past its deadline no longer blocks it');
rollback to aged_ready;

savepoint aged_queued;
select pg_temp.make_export('aged-queued','queued');
select pg_temp.age('aged-queued');
select ok(pg_temp.status('aged-queued')='queued' and not pg_temp.current('aged-queued'),
 'fixture: a copy no worker began within its 24 hours stays queued and is no longer current');
select throws_ok($$select pg_temp.worker('aged-queued','begin')$$,'42501','not_found','fixture: no worker can begin it');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(not exists(select 1 from jsonb_array_elements(public.export_archive_subject_due_v1()) v
  where v->>'exportId'=pg_temp.export_id('aged-queued')::text),'fixture: and the subject worker''s due reader does not list it');
reset role;
select lives_ok($$select pg_temp.delete_file()$$,'a queued copy past its deadline no longer blocks it');
rollback to aged_queued;

savepoint aged_writing;
select pg_temp.make_export('aged-writing','writing');
select pg_temp.age('aged-writing');
select ok(pg_temp.status('aged-writing')='building' and pg_temp.attempt_state('aged-writing')='writing' and not pg_temp.current('aged-writing'),
 'fixture: a copy whose worker was still writing when its 24 hours passed');
select throws_ok($$select pg_temp.worker('aged-writing','renew')$$,'42501','not_found','fixture: its worker can no longer renew');
select lives_ok($$select pg_temp.delete_file()$$,'a copy being built past its deadline no longer blocks it');
rollback to aged_writing;

-- Failed: the cleanup door's own stop, the transition the sweep makes when a
-- worker's lease lapses (synthetic timing: the deadline is still ahead).
savepoint failed;
select pg_temp.make_export('failed','writing');
select is(public.export_archive_cleanup_v1('stop',pg_temp.export_id('failed'),(select attempt from ex where label='failed'))->>'state',
 'cleanup-pending','fixture: the attempt is stopped through the cleanup door');
select ok(pg_temp.status('failed')='failed' and (select deadline>clock_timestamp() from private.export_archive_jobs
  where export_id=pg_temp.export_id('failed')) and not pg_temp.current('failed'),'fixture: the copy failed, its deadline still ahead');
select throws_ok($$select pg_temp.worker('failed','begin')$$,'42501','not_found','fixture: no worker can begin it again');
select lives_ok($$select pg_temp.delete_file()$$,'a failed copy no longer blocks it');
rollback to failed;

-- Ended: revoked while a worker was still writing it (synthetic: the
-- status-only revocation the claimant erasure writes on a claimed record).
-- Under D-144 this still blocked, because its attempt still held objects.
savepoint revoked;
select pg_temp.make_export('revoked','writing');
update public.generated_exports set status='revoked' where id=pg_temp.export_id('revoked');
select ok(pg_temp.attempt_state('revoked')='writing' and not pg_temp.current('revoked'),
 'fixture: a copy revoked while its attempt was still writing is no longer current');
select throws_ok($$select pg_temp.worker('revoked','renew')$$,'42501','not_found','fixture: its worker can no longer renew');
select lives_ok($$select pg_temp.delete_file()$$,'a revoked copy no longer blocks it, objects or not');
rollback to revoked;

-- Withdrawn-retired: a copy the self emptying retired, stopped through the
-- cleanup door and revoked (the emptying's own two steps, as D-144 wrote them).
savepoint retired;
select pg_temp.make_export('retired','ready');
select public.export_archive_cleanup_v1('stop',pg_temp.export_id('retired'),(select attempt from ex where label='retired'));
update public.generated_exports set status='revoked' where id=pg_temp.export_id('retired') and status<>'revoked';
select ok(pg_temp.status('retired')='revoked' and pg_temp.attempt_state('retired')='cleanup_pending','fixture: a copy retired by the emptying');
select lives_ok($$select pg_temp.delete_file()$$,'a copy retired by a withdrawal does not block it, as before');
rollback to retired;

-- The two statuses no door writes any more, on a copy that already failed
-- (synthetic: older rows may hold them).
savepoint legacy_status;
select pg_temp.make_export('legacy-status','writing');
select public.export_archive_cleanup_v1('stop',pg_temp.export_id('legacy-status'),(select attempt from ex where label='legacy-status'));
update public.generated_exports set status='expired' where id=pg_temp.export_id('legacy-status');
select lives_ok($$select pg_temp.delete_file()$$,'a copy marked expired does not block it');
rollback to legacy_status;
savepoint legacy_status;
select pg_temp.make_export('legacy-status','writing');
select public.export_archive_cleanup_v1('stop',pg_temp.export_id('legacy-status'),(select attempt from ex where label='legacy-status'));
update public.generated_exports set status='purged' where id=pg_temp.export_id('legacy-status');
select lives_ok($$select pg_temp.delete_file()$$,'a copy marked purged does not block it');
rollback to legacy_status;

-- Every kind of copy the guard reads --------------------------------------------------
-- Synthetic: an approved claimant's copy of a record (api.future-person-export,
-- origin independent-rights). None can exist on a record with a file an
-- account holds (a claimed record's one file has no account), so the row and
-- its job are placed directly; the guard reads a copy by its target, not by
-- the door that made it.
savepoint claimant;
insert into public.generated_exports(id,account_id,requester_principal_id,export_kind,target_kind,target_id,purpose,lifecycle_revision,
 principal_graph_revision,principal_graph_fingerprint,export_revision,subject_partitions,archive_version,origin_kind,status)
select '7d152000-0000-4000-8000-0000000000c1',null,(select id from public.subject_principals where account_id=alpha and subject_id=alpha_subject
  order by id limit 1),'subject_raw','subject',alpha_subject,'raw.export',1,1,repeat('a',64),1,jsonb_build_array(alpha_subject),
 'archive-segments-v1','independent-rights','queued' from fx;
insert into private.export_archive_jobs(export_id,origin,route_id,export_contract,origin_binding,authority_receipt,export_cookie_hash,
 principal_hash,created_at,deadline)
values('7d152000-0000-4000-8000-0000000000c1',jsonb_build_object('kind','independent-rights','sessionHash',repeat('e',64)),
 'api.future-person-export','approved-future-person-export-v1',repeat('a',64),repeat('b',64),repeat('9',64),repeat('d',64),
 statement_timestamp(),statement_timestamp()+interval '24 hours');
select throws_ok($$select pg_temp.delete_file()$$,'55000','file_delete_shared_graph','a claimant''s copy being made blocks it');
update public.generated_exports set status='building' where id='7d152000-0000-4000-8000-0000000000c1';
select throws_ok($$select pg_temp.delete_file()$$,'55000','file_delete_shared_graph','and while it is built');
select throws_ok($$update public.generated_exports set status='ready',completed_at=clock_timestamp(),expires_at=clock_timestamp()+interval '1 hour',
  archive_sha256=repeat('d',64),manifest_sha256=repeat('d',64),byte_count=3 where id='7d152000-0000-4000-8000-0000000000c1'$$,
 '55000','export_publication_not_integrated','such a copy can never be published READY');
update private.export_archive_jobs set created_at=statement_timestamp()-interval '25 hours',deadline=statement_timestamp()-interval '1 hour'
 where export_id='7d152000-0000-4000-8000-0000000000c1';
select lives_ok($$select pg_temp.delete_file()$$,'past its deadline it no longer blocks it');
rollback to claimant;
savepoint claimant;
insert into public.generated_exports(id,account_id,requester_principal_id,export_kind,target_kind,target_id,purpose,lifecycle_revision,
 principal_graph_revision,principal_graph_fingerprint,export_revision,subject_partitions,archive_version,origin_kind,status)
select '7d152000-0000-4000-8000-0000000000c1',null,(select id from public.subject_principals where account_id=alpha and subject_id=alpha_subject
  order by id limit 1),'subject_raw','subject',alpha_subject,'raw.export',1,1,repeat('a',64),1,jsonb_build_array(alpha_subject),
 'archive-segments-v1','independent-rights','revoked' from fx;
insert into private.export_archive_jobs(export_id,origin,route_id,export_contract,origin_binding,authority_receipt,export_cookie_hash,
 principal_hash,created_at,deadline)
values('7d152000-0000-4000-8000-0000000000c1',jsonb_build_object('kind','independent-rights','sessionHash',repeat('e',64)),
 'api.future-person-export','approved-future-person-export-v1',repeat('a',64),repeat('b',64),repeat('9',64),repeat('d',64),
 statement_timestamp(),statement_timestamp()+interval '24 hours');
select lives_ok($$select pg_temp.delete_file()$$,'a revoked claimant''s copy does not block it');
update public.generated_exports set status='failed' where id='7d152000-0000-4000-8000-0000000000c1';
select lives_ok($$select pg_temp.delete_file()$$,'nor a failed one');
rollback to claimant;

-- Synthetic: a legacy single-object row, queued and never given a job. No
-- door can make or serve it: the currentness check refuses a copy without its job.
savepoint legacy;
insert into public.generated_exports(id,account_id,requester_principal_id,export_kind,target_kind,target_id,purpose,lifecycle_revision,
 principal_graph_revision,principal_graph_fingerprint,export_revision,subject_partitions,status)
select '7d152000-0000-4000-8000-0000000000c2',alpha,(select id from public.subject_principals where account_id=alpha and subject_id=alpha_subject
  order by id limit 1),'subject_raw','subject',alpha_subject,'raw.export',1,1,repeat('a',64),1,jsonb_build_array(alpha_subject),'queued' from fx;
select throws_ok($$select private.export_archive_current_v1('7d152000-0000-4000-8000-0000000000c2',repeat('b',64))$$,
 '42501','not_found','fixture: a queued row with no job is not current');
select lives_ok($$select pg_temp.delete_file()$$,'a queued legacy row with no job does not block it');
rollback to legacy;

-- A whole-account copy was never read by the guard, and still is not. What
-- deleting the file does to it is unchanged (reported with D-152): its
-- currentness check then refuses, so its download stops.
savepoint account_copy;
select pg_temp.make_export('account-queued','queued');
select ok(pg_temp.status('account-queued')='queued' and pg_temp.current('account-queued'),'fixture: a whole-account copy is queued');
select lives_ok($$select pg_temp.delete_file()$$,'a queued whole-account copy does not block deleting the file, as before');
select throws_ok($$select pg_temp.poll('account-queued')$$,'55000','export_source_unavailable',
 'unchanged: once the file is prepared, the whole-account copy fails its currentness check');
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where bucket_id='genomes' and name='77900000-0000-4000-8000-000000000030';
select set_config('storage.allow_delete_query','false',true);
select lives_ok($$select public.finish_genome_file_deletion_v1((select alpha from fx),(select alpha_session from fx),(select file from fx),
  (select token from private.genome_file_deletions where file_id=(select file from fx)))$$,'the finish goes through as well');
select throws_ok($$select pg_temp.poll('account-queued')$$,'42501','not_found','and the whole-account copy is not found afterwards');
rollback to account_copy;
savepoint account_copy;
select pg_temp.make_export('account-ready','ready');
update ex set download=(pg_temp.open('account-ready')->>'downloadSessionId')::uuid where label='account-ready';
select ok(pg_temp.status('account-ready')='ready' and pg_temp.current('account-ready'),'fixture: a whole-account copy is READY and opened');
select lives_ok($$select pg_temp.delete_file()$$,'a READY whole-account copy does not block deleting the file, as before');
select throws_ok($$select private.account_archive_test_delivery_context_v1((select download from ex where label='account-ready'),repeat('7',64),
  pg_temp.origin('account-ready'))$$,'55000','export_source_unavailable',
 'unchanged: once the file is prepared, the READY whole-account copy''s download serves nothing more');
rollback to account_copy;

-- Another record's live copy does not block it -----------------------------------------
savepoint other_record;
select pg_temp.make_export('beta','ready');
select ok(pg_temp.status('beta')='ready' and pg_temp.current('beta'),'fixture: another person''s record has a READY copy');
select lives_ok($$select pg_temp.delete_file()$$,'a live copy of another record does not block deleting this file');
select ok(pg_temp.current('beta'),'and that copy stays current');
rollback to other_record;

-- The race: no copy can start once the deletion is prepared --------------------------
savepoint race;
select pg_temp.make_export('aged-queued','queued');
select pg_temp.age('aged-queued');
select lives_ok($$select pg_temp.delete_file()$$,'with only a copy past its deadline, the file is prepared for deletion');
select is((select state from public.genome_storage_objects where genome_file_id=(select file from fx)),'purge_queued',
 'fixture: its stored object is queued for purge');
select is(private.own_export_source_v1((select alpha from fx),(select alpha_session from fx),(select file from fx)),null::jsonb,
 'the source every capture reads no longer answers for the file');
select throws_ok($$select pg_temp.request('queued','capture')$$,'55000','export_source_unavailable',
 'a new copy of the record cannot be captured while the file awaits its finish');
select throws_ok($$select public.subject_export_request_v1('create',pg_temp.origin('queued'),(select alpha_subject from fx),
  jsonb_build_object('envelope',jsonb_build_object(),'exportCookieHash',repeat('1',64)),repeat('c',64))$$,'55000','export_source_unavailable',
 'nor created');
select throws_ok($$select pg_temp.request('account-queued','capture')$$,'55000','export_source_unavailable',
 'nor a new copy of the whole account');
select is((select count(*) from public.generated_exports where account_id=(select alpha from fx)),1::bigint,
 'no copy was made: the account holds only the one past its deadline');
-- The finish runs the guard again. Synthetic: a live copy of the record placed
-- directly, since no door can make one now.
savepoint placed;
insert into public.generated_exports(id,account_id,requester_principal_id,export_kind,target_kind,target_id,purpose,lifecycle_revision,
 principal_graph_revision,principal_graph_fingerprint,export_revision,subject_partitions,archive_version,status)
select '7d152000-0000-4000-8000-0000000000c3',alpha,(select id from public.subject_principals where account_id=alpha and subject_id=alpha_subject
  order by id limit 1),'subject_raw','subject',alpha_subject,'raw.export',1,1,repeat('a',64),1,jsonb_build_array(alpha_subject),
 'archive-segments-v1','queued' from fx;
insert into private.export_archive_jobs(export_id,origin,route_id,export_contract,origin_binding,authority_receipt,export_cookie_hash,
 principal_hash,created_at,deadline)
select '7d152000-0000-4000-8000-0000000000c3',jsonb_build_object('kind','account','accountId',alpha,'sessionId',alpha_session),
 'api.subject-export','subject-export-v1',repeat('a',64),repeat('b',64),repeat('8',64),repeat('d',64),statement_timestamp(),
 statement_timestamp()+interval '24 hours' from fx;
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where bucket_id='genomes' and name='77900000-0000-4000-8000-000000000030';
select set_config('storage.allow_delete_query','false',true);
select throws_ok($$select public.finish_genome_file_deletion_v1((select alpha from fx),(select alpha_session from fx),(select file from fx),
  (select token from private.genome_file_deletions where file_id=(select file from fx)))$$,'55000','file_delete_shared_graph',
 'the finish refuses while a live copy of the record exists');
select is((select count(*) from public.genome_files where id=(select file from fx)),1::bigint,'and the file stays, prepared');
rollback to placed;
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where bucket_id='genomes' and name='77900000-0000-4000-8000-000000000030';
select set_config('storage.allow_delete_query','false',true);
select lives_ok($$select public.finish_genome_file_deletion_v1((select alpha from fx),(select alpha_session from fx),(select file from fx),
  (select token from private.genome_file_deletions where file_id=(select file from fx)))$$,
 'with no live copy, the finish completes, as the route drains it');
select is((select count(*) from public.genome_files where id=(select file from fx)),0::bigint,'and the file is gone');
rollback to race;

-- The body is the reviewed successor ------------------------------------------------
select is((select md5(pg_get_functiondef('private.prepare_genome_file_deletion_body_v1(uuid,uuid)'::regprocedure))),
 '9753a5d9d38d09f6b17664826247f070','the per-file guard is the reviewed successor');
select is((select proacl::text from pg_proc where oid='private.prepare_genome_file_deletion_body_v1(uuid,uuid)'::regprocedure),
 '{postgres=X/postgres}','and its grants are unchanged');

select * from finish();
rollback;
