begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic empty own account is a real reachable partition, not an admin-
-- seeded ready archive. No provider objects, ZIP output or cleanup is asserted.
insert into auth.users(id,email) values
 ('79600000-0000-4000-8000-000000000001','archive-owner@e2e.local'),
 ('79600000-0000-4000-8000-000000000002','archive-other@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('79600000-0000-4000-8000-000000000010','79600000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('79600000-0000-4000-8000-000000000011','79600000-0000-4000-8000-000000000002',now(),now(),'aal1');
create temporary table archive_fixture(origin jsonb,capture jsonb,created jsonb);
insert into archive_fixture(origin) values(jsonb_build_object('kind','account','accountId','79600000-0000-4000-8000-000000000001',
 'sessionId','79600000-0000-4000-8000-000000000010'));
update archive_fixture set capture=public.export_archive_request_v1('capture',origin,'account','79600000-0000-4000-8000-000000000001');
create function pg_temp.envelope(op text,nonce text) returns jsonb language sql as $$
 select jsonb_build_object('routeId','api.export','origin','authenticated','principalId',capture->>'principalId',
  'targetKind','account','targetId','79600000-0000-4000-8000-000000000001','exportContract','account-export-v1',
  'originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt','csrfBinding',repeat('c',64),
  'operation',op,'nonceHash',nonce,'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
  'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)
  ||case when op='open-ready' then jsonb_build_object('exportId',created->>'exportId',
    'exportRevision',(created->>'exportRevision')::bigint) else '{}'::jsonb end
 from archive_fixture;
$$;
create function pg_temp.create_archive(nonce text,patch jsonb default '{}') returns jsonb language sql as $$
 select public.export_archive_request_v1('create',origin,'account','79600000-0000-4000-8000-000000000001',
  jsonb_build_object('envelope',pg_temp.envelope('create',nonce)||patch,'exportCookieHash',repeat('9',64)),repeat('c',64)) from archive_fixture;
$$;
select is((select capture->>'fileCount' from archive_fixture),'0','no-file own account has complete empty source membership');
select is((select jsonb_array_length(capture->'subjectPartitions') from archive_fixture),1,'real self subject is included');
select ok((select capture->>'authorityReceipt' ~ '^[0-9a-f]{64}$' from archive_fixture),'receipt is SQL-derived');
select throws_ok($$select public.export_archive_request_v1('capture',jsonb_build_object('kind','account',
 'accountId','79600000-0000-4000-8000-000000000001','sessionId','79600000-0000-4000-8000-000000000011'),
 'account','79600000-0000-4000-8000-000000000001')$$,'42501','not_found','foreign session does not inherit account');
select throws_ok($$select public.export_archive_request_v1('capture',(select origin from archive_fixture),
 'account','79600000-0000-4000-8000-000000000002')$$,'42501','not_found','foreign account target refused');
select throws_ok($$select public.export_archive_request_v1('capture','{"kind":"rights","sessionId":"79600000-0000-4000-8000-000000000010"}',
 'subject','79600000-0000-4000-8000-000000000001')$$,'0A000','export_origin_projection_unavailable','rights never borrow an uploader account');
select throws_ok($$select pg_temp.create_archive(repeat('a',64),'{"authorityReceipt":"changed"}')$$,
 '42501','not_found','caller receipt cannot substitute for current SQL authority');
select throws_ok($$select pg_temp.create_archive(repeat('a',64),'{"issuedAt":null}')$$,
 '42501','not_found','null token time refused rather than SQL unknown');
select throws_ok($$select pg_temp.create_archive(repeat('a',64),'{"exportContract":"token-target-export-v1"}')$$,
 '42501','not_found','cross-contract nonce refused');
select is((select count(*) from private.export_archive_jobs),0::bigint,'refused envelope rolls back job insertion');
select is((select count(*) from private.export_archive_nonce_uses),0::bigint,'refused envelope consumes no nonce');
update archive_fixture set created=pg_temp.create_archive(repeat('a',64));
select is((select created->>'status' from archive_fixture),'queued','valid one-use create commits queue');
select is((select count(*) from private.export_archive_nonce_uses),1::bigint,'create nonce consumed with job');
select throws_ok($$select pg_temp.create_archive(repeat('a',64))$$,'55000','export_already_pending','replay cannot create another live export');
select is((select count(*) from private.export_archive_jobs),1::bigint,'replay leaves exactly the original job');
select throws_ok($$select pg_temp.create_archive(repeat('b',64))$$,'55000','export_already_pending','different fresh nonce cannot create a second live route job');
select is((select count(*) from private.export_archive_nonce_uses),1::bigint,'duplicate live job refusal leaves fresh nonce unused');
select throws_ok($$select public.export_archive_request_v1('check',(select origin from archive_fixture),'account',
 '79600000-0000-4000-8000-000000000001',jsonb_build_object('exportId',(select created->>'exportId' from archive_fixture),'exportCookieHash',repeat('8',64)))$$,
 '42501','not_found','poll cannot rely on account authentication without exact export cookie');
select is(public.export_archive_request_v1('check',(select origin from archive_fixture),'account',
 '79600000-0000-4000-8000-000000000001',jsonb_build_object('exportId',(select created->>'exportId' from archive_fixture),'exportCookieHash',repeat('9',64)))->>'status',
 'queued','cookie-bound check reads existing job only');
select is((select count(*) from private.export_archive_nonce_uses),1::bigint,'poll does not mint or consume a nonce');
savepoint empty_queue_delete;
select lives_ok($$delete from public.generated_exports where id=(select (created->>'exportId')::uuid from archive_fixture)$$,
 'empty queue does not strand existing account database purge');
select is((select count(*) from private.export_archive_jobs),0::bigint,'empty delete removes private queue metadata');
select ok((select export_id is null and operation is null and envelope is null and consumed_at is null and expires_at>clock_timestamp()
 from private.export_archive_nonce_uses),'empty delete retains only hash and original expiry replay tombstone');
select throws_ok($$select pg_temp.create_archive(repeat('a',64))$$,'23505',null,'empty deletion cannot revive an unexpired operation nonce');
rollback to empty_queue_delete;
-- Legacy exports keep their original representation and ordinary delete path.
insert into public.generated_exports(id,account_id,requester_principal_id,export_kind,target_kind,target_id,purpose,
 lifecycle_revision,principal_graph_revision,principal_graph_fingerprint,export_revision)
 select '79600000-0000-4000-8000-000000000099','79600000-0000-4000-8000-000000000001',(capture->>'principalId')::uuid,
 'account_portable','account','79600000-0000-4000-8000-000000000001','raw.export',1,1,repeat('7',64),1 from archive_fixture;
select lives_ok($$delete from public.generated_exports where id='79600000-0000-4000-8000-000000000099'$$,'ordinary legacy export delete remains unchanged');
savepoint legacy_only_pending;
delete from public.generated_exports where id=(select (created->>'exportId')::uuid from archive_fixture);
insert into public.generated_exports(id,account_id,requester_principal_id,export_kind,target_kind,target_id,purpose,
 lifecycle_revision,principal_graph_revision,principal_graph_fingerprint,export_revision)
 select '79600000-0000-4000-8000-000000000098','79600000-0000-4000-8000-000000000001',(capture->>'principalId')::uuid,
 'account_portable','account','79600000-0000-4000-8000-000000000001','raw.export',1,1,repeat('7',64),1 from archive_fixture;
select throws_ok($$select pg_temp.create_archive(repeat('b',64))$$,'55000','export_already_pending',
 'legacy-only live export also prevents a parallel archive');
rollback to legacy_only_pending;
select is(jsonb_array_length(public.export_archive_due_v1('generation')),1,'bounded dispatcher discovers queued job without inventing authority');
select ok((select public=false and file_size_limit=4000000 and allowed_mime_types=array['application/octet-stream']
 from storage.buckets where id='exports'),'archive bucket is private and bounded per whole object');
select ok(not has_function_privilege('authenticated','public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text)','EXECUTE'),
 'authenticated cannot forge service operation envelopes');
select ok(has_function_privilege('service_role','public.export_archive_worker_v1(text,uuid,uuid,text,jsonb)','EXECUTE'),'worker RPC service-only entry exists');
select ok(not has_table_privilege('service_role','private.export_archive_segments','INSERT'),'service cannot bypass reservation RPC');
select ok(not has_function_privilege('service_role','private.export_archive_authority_v1(jsonb,text,uuid)','EXECUTE'),'private authority is not an alternate client API');

savepoint membership_change;
insert into public.subjects(id,owner_account_id,subject_class,upload_class,display_label,lifecycle)
 values('79600000-0000-4000-8000-000000000020','79600000-0000-4000-8000-000000000001','other_adult','adult','Synthetic reserved adult','draft');
select throws_ok($$select public.export_archive_request_v1('capture',(select origin from archive_fixture),'account',
 '79600000-0000-4000-8000-000000000001')$$,'0A000','export_partition_projection_unavailable','new unsupported owned partition refuses whole account');
rollback to membership_change;
savepoint source_membership_change;
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
 select '79600000-0000-4000-8000-000000000021','79600000-0000-4000-8000-000000000001',id,
 '79600000-0000-4000-8000-000000000022','Synthetic pending file','vcf',1,8,'uploading'
 from public.subjects where subject_account_id='79600000-0000-4000-8000-000000000001' and subject_class='self';
select throws_ok($$select public.export_archive_request_v1('capture',(select origin from archive_fixture),'account',
 '79600000-0000-4000-8000-000000000001')$$,'55000','export_source_unavailable','unready owned file refuses whole export instead of disappearing');
rollback to source_membership_change;
savepoint expired_origin;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='79600000-0000-4000-8000-000000000010';
select throws_ok($$select public.export_archive_request_v1('capture',(select origin from archive_fixture),'account',
 '79600000-0000-4000-8000-000000000001')$$,'42501','not_found','expired originating session cannot authorize export');
rollback to expired_origin;
savepoint revision_change;
update public.profiles set auth_session_revision=auth_session_revision+1 where id='79600000-0000-4000-8000-000000000001';
select throws_ok($$select public.export_archive_worker_v1('begin',(select (created->>'exportId')::uuid from archive_fixture),
 '79600000-0000-4000-8000-000000000030',(select capture->>'authorityReceipt' from archive_fixture))$$,
 '42501','not_found','changed session revision refuses initial claim');
rollback to revision_change;

create function pg_temp.worker(op text,payload jsonb default null,attempt uuid default '79600000-0000-4000-8000-000000000030')
 returns jsonb language sql as $$
 select public.export_archive_worker_v1(op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',payload) from archive_fixture;
$$;
create function pg_temp.segment(n bigint,sz integer,object_id uuid default null) returns jsonb language sql as $$
 select jsonb_build_object('ordinal',n,'offset',n*4000000,'sizeBytes',sz,'sha256',repeat('d',64),
  'objectKey',capture->>'principalHash'||'/'||(created->>'exportId')||'/79600000-0000-4000-8000-000000000030-'||n::text||'.part')
  ||case when object_id is null then '{}'::jsonb else jsonb_build_object('objectId',object_id) end from archive_fixture;
$$;
select is(pg_temp.worker('preflight')->>'authorityReceipt',(select capture->>'authorityReceipt' from archive_fixture),
 'actual core can check current receipt before beginning its fresh attempt');
select is((select count(*) from private.export_archive_attempts),0::bigint,'preflight creates no attempt or reservation');
select is(pg_temp.worker('begin')->>'attemptId','79600000-0000-4000-8000-000000000030','fresh attempt bound to current job');
select throws_ok($$select pg_temp.worker('preflight')$$,'42501','not_found','preflight cannot adopt an already claimed attempt');
savepoint empty_attempt_delete;
select lives_ok($$delete from public.generated_exports where id=(select (created->>'exportId')::uuid from archive_fixture)$$,
 'begun attempt without any reserved object does not strand account deletion');
select is((select count(*) from private.export_archive_attempts),0::bigint,'empty attempt metadata removed under job lock');
rollback to empty_attempt_delete;
select throws_ok($$select pg_temp.worker('begin')$$,'55000','export_attempt_unavailable','cannot adopt or duplicate live attempt');
select throws_ok($$select pg_temp.worker('reserve',pg_temp.segment(0,1)||'{"ordinal":"0"}')$$,
 '22023','invalid_request','numeric strings do not satisfy segment coordinate contract');
select throws_ok($$select pg_temp.worker('reserve',pg_temp.segment(1,1))$$,'55000','export_sequence','first segment cannot skip ordinal zero');
select throws_ok($$select pg_temp.worker('reserve',pg_temp.segment(0,1)||'{"objectKey":"other/key"}')$$,
 '22023','invalid_request','namespace comes from database job and attempt');
select is(pg_temp.worker('reserve',pg_temp.segment(0,4000000))->>'ordinal','0','exact whole object is reserved before write');
select throws_ok($$select pg_temp.worker('reserve',pg_temp.segment(0,4000000))$$,'55000','export_sequence','uncertain reservation is never retried or adopted');
select throws_ok($$select pg_temp.worker('acknowledge',pg_temp.segment(0,1,'79600000-0000-4000-8000-000000000040'))$$,
 '42501','not_found','ACK cannot change reserved length');
select throws_ok($$select pg_temp.worker('bytes-complete',jsonb_build_object('sizeBytes',4000000,'segmentCount',1,
 'pageCount',1,'sha256',repeat('e',64),'manifestSha256',repeat('f',64)))$$,'55000','export_incomplete','unacknowledged reservation blocks byte completion');
select throws_ok($$select pg_temp.worker('acknowledge',pg_temp.segment(0,4000000,'79600000-0000-4000-8000-000000000040'))$$,
 '42501','export_object_unavailable','ACK cannot invent a provider object absent from Storage metadata');
insert into storage.objects(id,bucket_id,name,metadata) values('79600000-0000-4000-8000-000000000040','exports',
 pg_temp.segment(0,4000000)->>'objectKey','{"size":4000000}');
select is(pg_temp.worker('acknowledge',pg_temp.segment(0,4000000,'79600000-0000-4000-8000-000000000040'))->>'ordinal','0','exact provider ACK persists object identity');
select throws_ok($$select pg_temp.worker('acknowledge',pg_temp.segment(0,4000000,'79600000-0000-4000-8000-000000000040'))$$,
 '42501','not_found','ACK cannot replay');
select is(pg_temp.worker('reserve',pg_temp.segment(1,7))->>'ordinal','1','second segment follows exact full extent');
select throws_ok($$select pg_temp.worker('acknowledge',pg_temp.segment(1,7,'79600000-0000-4000-8000-000000000040'))$$,
 '42501','export_object_unavailable','provider object identity cannot be reused across segment keys');
insert into storage.objects(id,bucket_id,name,metadata) values('79600000-0000-4000-8000-000000000041','exports',
 pg_temp.segment(1,7)->>'objectKey','{"size":7}');
select is(pg_temp.worker('acknowledge',pg_temp.segment(1,7,'79600000-0000-4000-8000-000000000041'))->>'ordinal','1','short final segment ACK accepted');
select throws_ok($$select pg_temp.worker('reserve',pg_temp.segment(2,1))$$,'55000','export_sequence','short segment cannot be followed by a hidden gap');
select throws_ok($$select pg_temp.worker('page',jsonb_build_object('page',0,'segments',jsonb_build_array(
 pg_temp.segment(0,4000000,'79600000-0000-4000-8000-000000000041'))))$$,
 '42501','not_found','manifest must equal acknowledged identities, not caller descriptor claims');
select is(pg_temp.worker('page',jsonb_build_object('page',0,'segments',jsonb_build_array(
 pg_temp.segment(0,4000000,'79600000-0000-4000-8000-000000000040'),
 pg_temp.segment(1,7,'79600000-0000-4000-8000-000000000041'))))->>'page','0','ordered acknowledged manifest page stored');
select throws_ok($$select pg_temp.worker('bytes-complete',jsonb_build_object('sizeBytes',4000006,'segmentCount',2,
 'pageCount',1,'sha256',repeat('e',64),'manifestSha256',repeat('f',64)))$$,'55000','export_incomplete','completion rejects a truncated byte total');
select is(pg_temp.worker('bytes-complete',jsonb_build_object('sizeBytes',4000007,'segmentCount',2,
 'pageCount',1,'sha256',repeat('e',64),'manifestSha256',repeat('f',64)))->>'state','bytes-complete','byte-only completion requires all objects and manifest pages');
select throws_ok($$update public.generated_exports set archive_version=null where id=(select (created->>'exportId')::uuid from archive_fixture)$$,
 '23514','export_identity_immutable','segmented job cannot evade publication hold by relabeling itself legacy');
select is((select status from public.generated_exports where id=(select (created->>'exportId')::uuid from archive_fixture)),
 'building','byte completion never publishes ready');
select throws_ok($$update public.generated_exports set status='ready' where id=(select (created->>'exportId')::uuid from archive_fixture)$$,
 '55000','export_publication_not_integrated','service cannot publish missing full ZIP/member proof');
select throws_ok($$select public.export_archive_request_v1('open-ready',(select origin from archive_fixture),'account',
 '79600000-0000-4000-8000-000000000001',jsonb_build_object('exportId',(select created->>'exportId' from archive_fixture),
 'envelope',pg_temp.envelope('open-ready',repeat('b',64)),'exportCookieHash',repeat('9',64),'downloadCookieHash',repeat('f',64)),repeat('c',64))$$,
 '42501','not_found','not-ready request cannot mint any download session');
select is((select count(*) from private.export_archive_downloads),0::bigint,'no partial download state');
select is((select count(*) from private.export_archive_nonce_uses),1::bigint,'not-ready refusal consumes no additional nonce');
select throws_ok($$delete from public.generated_exports where id=(select (created->>'exportId')::uuid from archive_fixture)$$,
 '55000','export_cleanup_incomplete','account purge cannot lose reserved keys through metadata cascade');
select is(public.export_archive_cleanup_v1('stop',(select (created->>'exportId')::uuid from archive_fixture),
 '79600000-0000-4000-8000-000000000030')->>'state','cleanup-pending','explicit cancellation preserves all reserved keys');
select is((select count(*) from private.export_archive_segments),2::bigint,'stop never drops object reservations');
select throws_ok($$select public.export_archive_cleanup_v1('list',(select (created->>'exportId')::uuid from archive_fixture),
 '79600000-0000-4000-8000-000000000030','{"afterOrdinal":-1}')$$,
 '55000','export_cleanup_not_due','cleanup cannot race an admitted in-flight write');
-- Clock advancement is metadata-only fixture work, not a physical deletion.
update private.export_archive_attempts set cleanup_not_before=clock_timestamp()-interval '1 second';
select is(jsonb_array_length(public.export_archive_cleanup_v1('list',(select (created->>'exportId')::uuid from archive_fixture),
 '79600000-0000-4000-8000-000000000030','{"afterOrdinal":-1}')),2,'cleanup lists exact owned reservations including failed attempts');
select is(public.export_archive_cleanup_v1('acknowledge-delete',(select (created->>'exportId')::uuid from archive_fixture),
 '79600000-0000-4000-8000-000000000030',jsonb_build_object('ordinal',0,'objectKey',pg_temp.segment(0,4000000)->>'objectKey'))->>'cleanupComplete',
 'false','provider ACK alone cannot claim late-write-fenced cleanup completion');
select is(jsonb_array_length(public.export_archive_cleanup_v1('list',(select (created->>'exportId')::uuid from archive_fixture),
 '79600000-0000-4000-8000-000000000030','{"afterOrdinal":-1}')),2,'previous delete ACK cannot hide a late-arriving write from reconciliation');
select throws_ok($$delete from public.generated_exports where id=(select (created->>'exportId')::uuid from archive_fixture)$$,
 '55000','export_cleanup_incomplete','ACKed keys still prevent unsafe metadata purge');
select is((select count(*) from private.export_archive_segments),2::bigint,'failed purge preserves every exact key atomically');
select is((select state from private.export_archive_attempts),'cleanup_pending','unproved provider fence keeps durable cleanup work');
select * from finish();
rollback;
