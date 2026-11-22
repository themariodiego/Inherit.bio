begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- D-152, follow-up (migration 20261122150000_file_delete_live_account_copies;
-- owner decision of 22 November 2026, "Only a live download copy blocks
-- deleting a single file", chosen as "A copy that is still being made or can
-- still be downloaded keeps blocking, so nothing in a live download goes
-- missing"): a copy of the whole account whose parts include the record is a
-- download copy of that record, and while live (queued or building, or ready
-- before its expiry, each before its job's deadline) it blocks deleting one
-- file with the existing file_delete_shared_graph refusal. A copy whose parts
-- do not include the record, one of another account, and one no longer live
-- do not block. Every copy here is made, opened and read through the current
-- doors; the states only time or another door would make (24 hours passing,
-- an expiry passing before the deadline, parts without the record, a
-- status-only revocation, another account's parts naming this record, a copy
-- placed while a deletion waits) are synthetic fixtures named as such. The
-- TEST R2 configuration is the transaction-local synthetic one the export
-- suites use; no provider is called. Each case runs in its own savepoint.
-- Everything rolls back.
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
 ('7d152b00-0000-4000-8000-000000000002','d152b-beta@example.invalid',clock_timestamp(),'{}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('7d152b00-0000-4000-8000-000000000012','7d152b00-0000-4000-8000-000000000002',clock_timestamp(),clock_timestamp(),'aal1');

create temporary table fx as select
 '77900000-0000-4000-8000-000000000001'::uuid alpha,
 '77900000-0000-4000-8000-000000000010'::uuid alpha_session,
 (select id from normalization_subject) alpha_subject,
 '77900000-0000-4000-8000-000000000040'::uuid file,
 '7d152b00-0000-4000-8000-000000000002'::uuid beta,
 '7d152b00-0000-4000-8000-000000000012'::uuid beta_session,
 (select id from public.subjects where subject_account_id='7d152b00-0000-4000-8000-000000000002' and subject_class='self') beta_subject;
grant select on fx to service_role;

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('file-delete-live-account-copies-test:'||p,'sha256'),'hex') $$;
-- Deleting the one file, exactly as api.file-delete's first call prepares it.
create function pg_temp.delete_file() returns jsonb language sql volatile as
 $$ select public.prepare_genome_file_deletion_v1((select alpha from fx),(select alpha_session from fx),(select file from fx)) $$;
create function pg_temp.notice() returns jsonb language sql stable as
 $$ select jsonb_build_object('contactCiphertext',repeat('ab',40),'contactHmac',repeat('c',64),
  'contactRevision',(select mail_contact_revision from public.profiles where id=(select alpha from fx))) $$;
-- The own-file withdrawal, through the door api.subject-delete sends a self record to.
create function pg_temp.withdraw(p_code text) returns jsonb language sql volatile as
 $$ select public.empty_self_subject_with_notice_v1((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),
  pg_temp.h(p_code),clock_timestamp()+interval '5 minutes',pg_temp.notice()) $$;

-- Whole-account copies, each through the whole account's doors (api.export).
-- ex.label names the case; 'beta-account' is another person's.
create temporary table ex(label text primary key,kind text,account uuid,session uuid,target uuid,attempt uuid,cookie text,
 capture jsonb,created jsonb,frame jsonb,ready jsonb,download uuid);
insert into ex(label,kind,account,session,target,attempt,cookie)
select label,'account',fx.alpha,fx.alpha_session,fx.alpha,attempt::uuid,repeat(cookie,64)
from fx,(values
 ('queued','7d152b00-0000-4000-8000-0000000000a1','1'),('writing','7d152b00-0000-4000-8000-0000000000a2','2'),
 ('bytes','7d152b00-0000-4000-8000-0000000000a3','3'),('ready','7d152b00-0000-4000-8000-0000000000a4','4'),
 ('expired','7d152b00-0000-4000-8000-0000000000a5','5'),('aged-ready','7d152b00-0000-4000-8000-0000000000a6','6'),
 ('aged-queued','7d152b00-0000-4000-8000-0000000000a7','7'),('aged-writing','7d152b00-0000-4000-8000-0000000000a8','8'),
 ('failed','7d152b00-0000-4000-8000-0000000000a9','9'),('revoked','7d152b00-0000-4000-8000-0000000000aa','a'),
 ('legacy-status','7d152b00-0000-4000-8000-0000000000ab','b'),('elsewhere-queued','7d152b00-0000-4000-8000-0000000000ac','c'),
 ('elsewhere-writing','7d152b00-0000-4000-8000-0000000000ad','d'),('elsewhere-ready','7d152b00-0000-4000-8000-0000000000ae','e'))
 x(label,attempt,cookie)
union all select 'beta-account','account',beta,beta_session,beta,'7d152b00-0000-4000-8000-0000000000af',repeat('f',64) from fx;
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
-- Whether a copy's parts include the record.
create function pg_temp.includes(p_label text) returns boolean language sql stable as
 $$ select subject_partitions @> jsonb_build_array((select alpha_subject from fx)) from public.generated_exports
  where id=pg_temp.export_id(p_label) $$;
-- Synthetic: rewrites a copy's parts so that they do not include the
-- record (the identity guard and the deferred checks set aside for the one
-- statement).
create function pg_temp.exclude_record(p_label text) returns void language plpgsql as $$
begin
 set local session_replication_role=replica;
 update public.generated_exports set subject_partitions=jsonb_build_array('7d152b00-0000-4000-8000-0000000001ff')
  where id=pg_temp.export_id(p_label);
 set local session_replication_role=origin;
end $$;

-- Each whole-account copy that includes the record and is live blocks -----------------
savepoint no_copy;
select lives_ok($$select pg_temp.delete_file()$$,'with no copy at all, the one file can be deleted alone');
rollback to no_copy;

savepoint live_queued;
select pg_temp.make_export('queued','queued');
select ok(pg_temp.status('queued')='queued' and pg_temp.current('queued') and pg_temp.includes('queued'),
 'fixture: a whole-account copy that includes the record is queued');
select throws_ok($$select pg_temp.delete_file()$$,'55000','file_delete_shared_graph','a queued whole-account copy blocks it');
rollback to live_queued;

savepoint live_writing;
select pg_temp.make_export('writing','writing');
select ok(pg_temp.status('writing')='building' and pg_temp.attempt_state('writing')='writing' and pg_temp.current('writing'),
 'fixture: a worker is building a whole-account copy and writing an object of it');
select throws_ok($$select pg_temp.delete_file()$$,'55000','file_delete_shared_graph','a whole-account copy being built blocks it');
rollback to live_writing;

savepoint live_bytes;
select pg_temp.make_export('bytes','bytes');
select ok(pg_temp.status('bytes')='building' and pg_temp.attempt_state('bytes')='bytes_complete' and pg_temp.current('bytes'),
 'fixture: every byte of a whole-account copy is written and it awaits publication');
select throws_ok($$select pg_temp.delete_file()$$,'55000','file_delete_shared_graph','a whole-account copy written but not yet published blocks it');
rollback to live_bytes;

savepoint live_ready;
select pg_temp.make_export('ready','ready');
update ex set download=(pg_temp.open('ready')->>'downloadSessionId')::uuid where label='ready';
select ok(private.issue_account_archive_test_chunk_v1((select download from ex where label='ready'),repeat('7',64),pg_temp.origin('ready'),
  0,repeat('3',64),repeat('d',64),3),'fixture: a READY whole-account copy is opened and its first chunk issued');
select throws_ok($$select pg_temp.delete_file()$$,'55000','file_delete_shared_graph','a READY whole-account copy mid-download blocks it');
select is((select count(*) from private.genome_file_deletions where file_id=(select file from fx)),0::bigint,'nothing is prepared: the file stays');
select ok(private.ack_account_archive_test_chunk_v1((select download from ex where label='ready'),repeat('7',64),pg_temp.origin('ready'),
  0,repeat('3',64),repeat('d',64),3),'and the download goes on: the chunk in flight is acknowledged');
rollback to live_ready;

-- Each whole-account copy that is no longer live does not block ------------------------
savepoint expired;
select pg_temp.make_export('expired','ready');
update ex set download=(pg_temp.open('expired')->>'downloadSessionId')::uuid where label='expired';
select pg_temp.expire('expired');
select ok((select status='ready' and expires_at<=clock_timestamp() from public.generated_exports where id=pg_temp.export_id('expired'))
  and (select deadline>clock_timestamp() from private.export_archive_jobs where export_id=pg_temp.export_id('expired')),
 'fixture: a READY whole-account copy past its expiry, its deadline still ahead');
select throws_ok($$select pg_temp.open('expired')$$,'42501','not_found','fixture: it no longer opens');
select throws_ok($$select private.account_archive_test_delivery_context_v1((select download from ex where label='expired'),repeat('7',64),pg_temp.origin('expired'))$$,
 '42501',null,'fixture: and a download opened before its expiry serves nothing more');
select lives_ok($$select pg_temp.delete_file()$$,'a READY whole-account copy past its expiry does not block it');
rollback to expired;

savepoint aged_ready;
select pg_temp.make_export('aged-ready','ready');
select pg_temp.age('aged-ready');
select ok(pg_temp.status('aged-ready')='ready' and not pg_temp.current('aged-ready'),'fixture: a READY whole-account copy past its deadline');
select lives_ok($$select pg_temp.delete_file()$$,'a READY whole-account copy past its deadline does not block it');
rollback to aged_ready;

savepoint aged_queued;
select pg_temp.make_export('aged-queued','queued');
select pg_temp.age('aged-queued');
select ok(pg_temp.status('aged-queued')='queued' and not pg_temp.current('aged-queued'),'fixture: a queued whole-account copy past its deadline');
select throws_ok($$select pg_temp.worker('aged-queued','begin')$$,'42501','not_found','fixture: no worker can begin it');
select lives_ok($$select pg_temp.delete_file()$$,'a queued whole-account copy past its deadline does not block it');
rollback to aged_queued;

savepoint aged_writing;
select pg_temp.make_export('aged-writing','writing');
select pg_temp.age('aged-writing');
select ok(pg_temp.attempt_state('aged-writing')='writing' and not pg_temp.current('aged-writing'),
 'fixture: a whole-account copy whose worker was still writing when its deadline passed');
select lives_ok($$select pg_temp.delete_file()$$,'a whole-account copy being built past its deadline does not block it');
rollback to aged_writing;

savepoint failed;
select pg_temp.make_export('failed','writing');
select public.export_archive_cleanup_v1('stop',pg_temp.export_id('failed'),(select attempt from ex where label='failed'));
select ok(pg_temp.status('failed')='failed' and not pg_temp.current('failed'),'fixture: a whole-account copy stopped through the cleanup door has failed');
select lives_ok($$select pg_temp.delete_file()$$,'a failed whole-account copy does not block it');
rollback to failed;

-- Synthetic: the status-only revocation the subject transfer writes on a
-- whole-account copy, its attempt still writing.
savepoint revoked;
select pg_temp.make_export('revoked','writing');
update public.generated_exports set status='revoked' where id=pg_temp.export_id('revoked');
select lives_ok($$select pg_temp.delete_file()$$,'a revoked whole-account copy does not block it, objects or not');
rollback to revoked;

-- Synthetic: the two statuses no door writes any more, on a copy that failed.
savepoint legacy_status;
select pg_temp.make_export('legacy-status','writing');
select public.export_archive_cleanup_v1('stop',pg_temp.export_id('legacy-status'),(select attempt from ex where label='legacy-status'));
update public.generated_exports set status='expired' where id=pg_temp.export_id('legacy-status');
select lives_ok($$select pg_temp.delete_file()$$,'a whole-account copy marked expired does not block it');
update public.generated_exports set status='purged' where id=pg_temp.export_id('legacy-status');
select lives_ok($$select pg_temp.delete_file()$$,'nor one marked purged');
rollback to legacy_status;

-- A whole-account copy whose parts do not include the record --------------------------
-- Synthetic: every real whole-account copy of the account includes its own
-- self record, so the parts are rewritten with the identity guard set aside.
savepoint elsewhere_queued;
select pg_temp.make_export('elsewhere-queued','queued');
select pg_temp.exclude_record('elsewhere-queued');
select ok(not pg_temp.includes('elsewhere-queued') and pg_temp.status('elsewhere-queued')='queued',
 'fixture: a queued whole-account copy whose parts do not include the record');
select lives_ok($$select pg_temp.delete_file()$$,'a queued whole-account copy without the record does not block it');
rollback to elsewhere_queued;

savepoint elsewhere_writing;
select pg_temp.make_export('elsewhere-writing','writing');
select pg_temp.exclude_record('elsewhere-writing');
select lives_ok($$select pg_temp.delete_file()$$,'a whole-account copy without the record being built does not block it');
rollback to elsewhere_writing;

savepoint elsewhere_ready;
select pg_temp.make_export('elsewhere-ready','ready');
select pg_temp.exclude_record('elsewhere-ready');
select ok(not pg_temp.includes('elsewhere-ready') and pg_temp.status('elsewhere-ready')='ready',
 'fixture: a READY whole-account copy whose parts do not include the record');
select lives_ok($$select pg_temp.delete_file()$$,'a READY whole-account copy without the record does not block it');
rollback to elsewhere_ready;

-- Another account's copies -----------------------------------------------------------
savepoint other_account;
select pg_temp.make_export('beta-account','ready');
select ok(pg_temp.status('beta-account')='ready' and pg_temp.current('beta-account'),'fixture: another person''s whole-account copy is READY');
select lives_ok($$select pg_temp.delete_file()$$,'another account''s live whole-account copy does not block it');
select ok(pg_temp.current('beta-account'),'and that copy stays current');
rollback to other_account;
-- Synthetic: another account's live whole-account copy whose parts name this
-- record (impossible through the doors: a capture only takes its own records).
savepoint other_account_naming;
select pg_temp.make_export('beta-account','queued');
set local session_replication_role=replica;
update public.generated_exports set subject_partitions=subject_partitions||jsonb_build_array((select alpha_subject from fx))
 where id=pg_temp.export_id('beta-account');
set local session_replication_role=origin;
select ok((select subject_partitions @> jsonb_build_array(alpha_subject) from public.generated_exports,fx where id=pg_temp.export_id('beta-account')),
 'fixture: another account''s queued whole-account copy names this record in its parts');
select lives_ok($$select pg_temp.delete_file()$$,'it does not block it: only the account''s own copies are read');
rollback to other_account_naming;

-- The withdrawal is not blocked by these copies ----------------------------------------
-- It ends every whole-account copy that includes the record before it
-- prepares the files through the same guard (20261122130000).
savepoint withdrawal;
select pg_temp.make_export('ready','ready');
select set_config('inherit.legal_audit_actor','',true);
create temporary table withdrawn(body jsonb);
grant select,insert on withdrawn to service_role;
set local role service_role;
select lives_ok($$insert into withdrawn select pg_temp.withdraw('with-live-account-copy')$$,
 'the own-file withdrawal runs while a READY whole-account copy includes the record');
reset role;
select is((select body->'files' from withdrawn),jsonb_build_array((select file from fx)),'and prepares the record''s file');
select is(pg_temp.status('ready')||' '||pg_temp.attempt_state('ready'),'revoked cleanup_pending','the copy was ended first');
rollback to withdrawal;

-- The race: the profile row serialises a whole-account copy with the deletion -------
-- The guard's first statement locks the account's profile row FOR UPDATE.
select ok(position('perform 1 from public.profiles where id=p_account_id for update;' in
  pg_get_functiondef('private.prepare_genome_file_deletion_body_v1(uuid,uuid)'::regprocedure))
  < position('raise exception using errcode=''55000'', message=''file_delete_shared_graph''' in
  pg_get_functiondef('private.prepare_genome_file_deletion_body_v1(uuid,uuid)'::regprocedure)),
 'the guard locks the profile row before it reads any copy');
-- Capturing a whole-account copy takes the same row FOR UPDATE, as the
-- bodies deployed now do (shown on Beta's row, which nothing has locked yet
-- in this transaction).
savepoint profile_lock;
create extension if not exists pgrowlocks with schema extensions;
select is((select count(*) from extensions.pgrowlocks('public.profiles') r join public.profiles p on p.ctid=r.locked_row
  where p.id=(select beta from fx)),0::bigint,'fixture: no lock is held on that account''s profile row');
select ok(pg_temp.request('beta-account','capture') is not null,'fixture: a whole-account copy of that account is captured');
select ok(exists(select 1 from extensions.pgrowlocks('public.profiles') r join public.profiles p on p.ctid=r.locked_row
  where p.id=(select beta from fx) and 'For Update'=any(r.modes)),
 'the capture holds the account''s profile row FOR UPDATE, the row the guard locks first');
rollback to profile_lock;
-- Once a deletion is prepared, no whole-account copy can start.
savepoint race;
select lives_ok($$select pg_temp.delete_file()$$,'with no copy, the file is prepared for deletion');
select throws_ok($$select pg_temp.request('queued','capture')$$,'55000','export_source_unavailable',
 'a whole-account copy cannot be captured while the file awaits its finish');
select throws_ok($$select pg_temp.request('queued','create',jsonb_build_object('envelope',jsonb_build_object(),'exportCookieHash',repeat('1',64)),
  repeat('c',64))$$,'55000','export_source_unavailable','nor created');
-- The finish runs the guard again. Synthetic: a live whole-account copy
-- that includes the record, placed directly, since no door can make one now.
savepoint placed;
insert into public.generated_exports(id,account_id,requester_principal_id,export_kind,target_kind,target_id,purpose,lifecycle_revision,
 principal_graph_revision,principal_graph_fingerprint,export_revision,subject_partitions,archive_version,status)
select '7d152b00-0000-4000-8000-0000000000c3',alpha,(select id from public.subject_principals where account_id=alpha and subject_id=alpha_subject
  order by id limit 1),'account_portable','account',alpha,'raw.export',1,1,repeat('a',64),1,jsonb_build_array(alpha_subject),
 'archive-segments-v1','queued' from fx;
insert into private.export_archive_jobs(export_id,origin,route_id,export_contract,origin_binding,authority_receipt,export_cookie_hash,
 principal_hash,created_at,deadline)
select '7d152b00-0000-4000-8000-0000000000c3',jsonb_build_object('kind','account','accountId',alpha,'sessionId',alpha_session),
 'api.export','account-export-v1',repeat('a',64),repeat('b',64),repeat('8',64),repeat('d',64),statement_timestamp(),
 statement_timestamp()+interval '24 hours' from fx;
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where bucket_id='genomes' and name='77900000-0000-4000-8000-000000000030';
select set_config('storage.allow_delete_query','false',true);
select throws_ok($$select public.finish_genome_file_deletion_v1((select alpha from fx),(select alpha_session from fx),(select file from fx),
  (select token from private.genome_file_deletions where file_id=(select file from fx)))$$,'55000','file_delete_shared_graph',
 'the finish refuses while a live whole-account copy that includes the record exists');
rollback to placed;
rollback to race;

-- The body is the reviewed successor ------------------------------------------------
select is((select md5(pg_get_functiondef('private.prepare_genome_file_deletion_body_v1(uuid,uuid)'::regprocedure))),
 'da3c101a8a28000656359a91254a6643','the per-file guard is the reviewed successor of 20261122150000');
select is((select proacl::text from pg_proc where oid='private.prepare_genome_file_deletion_body_v1(uuid,uuid)'::regprocedure),
 '{postgres=X/postgres}','and its grants are unchanged');

select * from finish();
rollback;
