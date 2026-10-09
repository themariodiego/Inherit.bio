begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic empty own account is a real reachable partition, not an admin-
-- seeded ready archive. No provider objects, ZIP output or cleanup is asserted.
insert into auth.users(id,email) values
 ('79700000-0000-4000-8000-000000000001','archive-owner@e2e.local'),
 ('79700000-0000-4000-8000-000000000002','archive-other@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('79700000-0000-4000-8000-000000000010','79700000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('79700000-0000-4000-8000-000000000011','79700000-0000-4000-8000-000000000002',now(),now(),'aal1');
create temporary table archive_fixture(origin jsonb,capture jsonb,created jsonb);
insert into archive_fixture(origin) values(jsonb_build_object('kind','account','accountId','79700000-0000-4000-8000-000000000001',
 'sessionId','79700000-0000-4000-8000-000000000010'));
update archive_fixture set capture=public.export_archive_request_v1('capture',origin,'account','79700000-0000-4000-8000-000000000001');
create function pg_temp.envelope(op text,nonce text) returns jsonb language sql as $$
 select jsonb_build_object('routeId','api.export','origin','authenticated','principalId',capture->>'principalId',
  'targetKind','account','targetId','79700000-0000-4000-8000-000000000001','exportContract','account-export-v1',
  'originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt','csrfBinding',repeat('c',64),
  'operation',op,'nonceHash',nonce,'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
  'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)
  ||case when op='open-ready' then jsonb_build_object('exportId',created->>'exportId',
    'exportRevision',(created->>'exportRevision')::bigint) else '{}'::jsonb end
 from archive_fixture;
$$;
create function pg_temp.create_archive(nonce text,patch jsonb default '{}') returns jsonb language sql as $$
 select public.export_archive_request_v1('create',origin,'account','79700000-0000-4000-8000-000000000001',
  jsonb_build_object('envelope',pg_temp.envelope('create',nonce)||patch,'exportCookieHash',repeat('9',64)),repeat('c',64)) from archive_fixture;
$$;
-- Native authority/reservation/ACK unit fixtures only. No physical R2 PUT,
-- EOF, provider availability or production/generation acceptance is claimed.
update archive_fixture set created=pg_temp.create_archive(repeat('a',64));
create function pg_temp.worker(op text,payload jsonb default null) returns jsonb language sql as $$
 select public.export_archive_worker_v1(op,(created->>'exportId')::uuid,
  '79700000-0000-4000-8000-000000000030',capture->>'authorityReceipt',payload) from archive_fixture;
$$;
create function pg_temp.segment(n bigint,object_id uuid default null) returns jsonb language sql as $$
 select jsonb_build_object('ordinal',n,'offset',n*4000000,'sizeBytes',3,'sha256',repeat('d',64),
  'objectKey',capture->>'principalHash'||'/'||(created->>'exportId')||'/79700000-0000-4000-8000-000000000030-'||n::text||'.part')
  ||case when object_id is null then '{}'::jsonb else jsonb_build_object('objectId',object_id) end from archive_fixture;
$$;
create function pg_temp.reserve_r2(claim text default repeat('1',64)) returns jsonb language sql as $$
 select private.reserve_account_archive_r2_write_v1('79700000-0000-4000-8000-000000000030',0,
  capture->>'authorityReceipt',claim) from archive_fixture;
$$;
select is(pg_temp.worker('begin')->>'attemptId','79700000-0000-4000-8000-000000000030','existing account attempt starts through unchanged worker');
select is(pg_temp.worker('reserve',pg_temp.segment(0))->>'ordinal','0','ordinary exact segment INSERT precedes R2 allocation');
select throws_ok($$select pg_temp.reserve_r2()$$,'42501','account_archive_r2_unavailable','provider configuration starts closed');
select is((select count(*) from private.account_archive_r2_allocations),0::bigint,'disabled configuration creates no R2 allocation');
-- Explicit transaction-local synthetic enabled provider config, never shipped.
update private.account_archive_r2_configuration set enabled=true,bucket='inherit-export-test',binding_sha256=repeat('2',64);
create temporary table r2_fixture(frame jsonb,disposal jsonb);
insert into r2_fixture(frame) select pg_temp.reserve_r2();
select is((select frame#>>'{writeIdentity,attemptId}' from r2_fixture),'79700000-0000-4000-8000-000000000030','R2 frame retains exact account attempt');
select is((select frame#>>'{writeIdentity,authorityReceipt}' from r2_fixture),(select capture->>'authorityReceipt' from archive_fixture),'R2 frame binds current native authority');
select ok((select frame#>>'{writeIdentity,locator,objectKey}' ~ '^export/[0-9a-f-]{36}$' from r2_fixture),'provider allocation uses opaque native key');
select is((select count(*) from storage.objects where id=(select (frame->>'objectId')::uuid from r2_fixture)),0::bigint,'R2 reservation is never a storage.objects identity');
select throws_ok($$select pg_temp.reserve_r2()$$,'23505',null,'unknown INSERT response cannot adopt/re-reserve existing allocation');
select throws_ok($$select private.current_account_archive_r2_write_v1('79700000-0000-4000-8000-000000000030',0,
 (select capture->>'authorityReceipt' from archive_fixture),repeat('9',64))$$,'42501','account_archive_r2_unavailable','foreign write claim refused');
savepoint config_change;
update private.account_archive_r2_configuration set binding_sha256=repeat('3',64);
select throws_ok($$select private.current_account_archive_r2_write_v1('79700000-0000-4000-8000-000000000030',0,
 (select capture->>'authorityReceipt' from archive_fixture),repeat('1',64))$$,'42501','account_archive_r2_unavailable','changed provider configuration refused');
rollback to config_change;
savepoint origin_change;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='79700000-0000-4000-8000-000000000010';
select throws_ok($$select private.current_account_archive_r2_write_v1('79700000-0000-4000-8000-000000000030',0,
 (select capture->>'authorityReceipt' from archive_fixture),repeat('1',64))$$,'42501','not_found','expired account session cannot complete R2 write');
rollback to origin_change;
select throws_ok($$select pg_temp.worker('acknowledge',pg_temp.segment(0,(select (frame->>'objectId')::uuid from r2_fixture)))$$,
 '42501','account_archive_r2_unavailable','unwritten allocation cannot ACK');
select throws_ok($$select private.complete_account_archive_r2_write_v1('79700000-0000-4000-8000-000000000030',0,
 (select capture->>'authorityReceipt' from archive_fixture),repeat('1',64),(select frame||'{"objectId":"79700000-0000-4000-8000-000000000099"}' from r2_fixture),'version1','etag1')$$,
 '42501','account_archive_r2_unavailable','native complete refuses changed exact frame');
select is(private.complete_account_archive_r2_write_v1('79700000-0000-4000-8000-000000000030',0,
 (select capture->>'authorityReceipt' from archive_fixture),repeat('1',64),(select frame from r2_fixture),'version1','etag1'),
 (select (frame->>'objectId')::uuid from r2_fixture),'reviewed owner callback records exact provider identity');
select throws_ok($$select private.complete_account_archive_r2_write_v1('79700000-0000-4000-8000-000000000030',0,
 (select capture->>'authorityReceipt' from archive_fixture),repeat('1',64),(select frame from r2_fixture),'version1','etag1')$$,
 '42501','account_archive_r2_unavailable','native completion is not replayable');
select throws_ok($$select pg_temp.worker('acknowledge',pg_temp.segment(0,'79700000-0000-4000-8000-000000000099'))$$,
 '42501','account_archive_r2_unavailable','worker ACK refuses foreign object ID');
select is(pg_temp.worker('acknowledge',pg_temp.segment(0,(select (frame->>'objectId')::uuid from r2_fixture)))->>'ordinal','0',
 'recorded R2 ACK persists native ID without Storage metadata');
select is((select segment_count from private.export_archive_attempts where id='79700000-0000-4000-8000-000000000030'),1::bigint,'exact ACK advances sequence once');
select throws_ok($$select pg_temp.worker('acknowledge',pg_temp.segment(0,(select (frame->>'objectId')::uuid from r2_fixture)))$$,
 '42501','account_archive_r2_unavailable','worker ACK cannot replay');
select throws_ok($$update private.account_archive_r2_allocations set provider_key='export/79700000-0000-4000-8000-000000000099'$$,
 '23514','account_archive_r2_identity_immutable','opaque identity cannot be relabeled');
select throws_ok($$delete from private.account_archive_r2_allocations$$,'55000','account_archive_r2_allocation_retained','uncertain allocations cannot disappear');
select ok(not has_function_privilege('service_role','private.reserve_account_archive_r2_write_v1(uuid,bigint,text,text)','EXECUTE'),'service cannot bypass owner allocation door');
select ok(not has_function_privilege('service_role','public.export_archive_worker_before_account_r2_v1(text,uuid,uuid,text,jsonb)','EXECUTE'),'old Storage ACK cannot bypass recorded R2 wrapper');
select ok(has_function_privilege('service_role','public.export_archive_worker_v1(text,uuid,uuid,text,jsonb)','EXECUTE'),'original worker service ABI retained');
select is((select status from public.generated_exports where id=(select (created->>'exportId')::uuid from archive_fixture)),'building','R2 ACK supplies no ready capability');
select is(public.export_archive_cleanup_v1('stop',(select (created->>'exportId')::uuid from archive_fixture),
 '79700000-0000-4000-8000-000000000030')->>'state','cleanup-pending','stop retains native R2 reservation');
select throws_ok($$select private.claim_account_archive_r2_disposal_v1('79700000-0000-4000-8000-000000000030',0,repeat('4',64))$$,
 '42501','account_archive_r2_unavailable','disposal cannot race original in-flight deadline');
-- Separate expired reservation fixture directly seeded by owner for the cleanup
-- clock contract. It is not a successful provider write or live reserve claim.
insert into private.export_archive_segments(attempt_id,ordinal,byte_offset,byte_count,sha256,object_key)
 select '79700000-0000-4000-8000-000000000030',1,4000000,3,repeat('d',64),pg_temp.segment(1)->>'objectKey';
insert into private.account_archive_r2_allocations(attempt_id,ordinal,bucket,provider_key,configuration_sha256,allocation_sha256,
 write_identity,write_binding_sha256,write_claim,original_deadline)
 select '79700000-0000-4000-8000-000000000030',1,'inherit-export-test','export/79700000-0000-4000-8000-000000000051',repeat('2',64),
 encode(digest(convert_to('inherit-export-r2-allocation-v1'||chr(10)||'inherit-export-test'||chr(10)||'export/79700000-0000-4000-8000-000000000051','UTF8'),'sha256'),'hex'),
 identity_row,encode(digest(convert_to(identity_row::text,'UTF8'),'sha256'),'hex'),repeat('5',64),clock_timestamp()-interval '1 minute'
 from (select jsonb_set(jsonb_set(jsonb_set(jsonb_set(frame->'writeIdentity','{ordinal}','1'),'{offset}','4000000'),
 '{logicalKey}',to_jsonb(pg_temp.segment(1)->>'objectKey')),'{locator,objectKey}','"export/79700000-0000-4000-8000-000000000051"') identity_row from r2_fixture) q;
update private.export_archive_attempts set cleanup_not_before=clock_timestamp()-interval '1 second' where id='79700000-0000-4000-8000-000000000030';
update r2_fixture set disposal=private.claim_account_archive_r2_disposal_v1('79700000-0000-4000-8000-000000000030',1,repeat('4',64));
select is((select disposal->>'ordinal' from r2_fixture),'1','exact due reservation receives exclusive finite claim');
select throws_ok($$select private.claim_account_archive_r2_disposal_v1('79700000-0000-4000-8000-000000000030',1,repeat('6',64))$$,
 '42501','account_archive_r2_unavailable','another owner cannot steal unexpired disposal claim');
select throws_ok($$select private.check_account_archive_r2_disposal_v1('79700000-0000-4000-8000-000000000030',1,repeat('4',64),
 (select disposal||'{"authorityReceipt":"foreign"}' from r2_fixture))$$,'42501','account_archive_r2_unavailable','disposal checks complete current frame');
create function pg_temp.evidence() returns jsonb language sql as $$
 select jsonb_build_object('version','archive-r2-current-object-evidence-v1','reservationSha256',disposal->>'reservationSha256',
  'allocationSha256',disposal->>'allocationSha256','disposition','current-payload-tombstoned','historyScope','current-object-only',
  'marker',jsonb_build_object('objectKey',disposal#>>'{locator,objectKey}','version','marker1','etag','marker-etag','byteCount',0,
   'allocationSha256',disposal->>'allocationSha256','kind','permanent-empty-fence','writeBindingSha256',null)) from r2_fixture;
$$;
select throws_ok($$select private.ack_account_archive_r2_disposal_v1('79700000-0000-4000-8000-000000000030',1,repeat('4',64),
 (select disposal from r2_fixture),jsonb_set(pg_temp.evidence(),'{marker,allocationSha256}',to_jsonb(repeat('f',64))))$$,
 '42501','account_archive_r2_unavailable','foreign permanent marker cannot ACK');
select ok(private.ack_account_archive_r2_disposal_v1('79700000-0000-4000-8000-000000000030',1,repeat('4',64),
 (select disposal from r2_fixture),pg_temp.evidence()),'owner records complete exact fence evidence');
select is((select count(*) from private.account_archive_r2_allocations),2::bigint,'disposal evidence retains all allocation metadata');
select throws_ok($$select private.ack_account_archive_r2_disposal_v1('79700000-0000-4000-8000-000000000030',1,repeat('4',64),
 (select disposal from r2_fixture),pg_temp.evidence())$$,'42501','account_archive_r2_unavailable','disposed reservation cannot be ACKed twice');
select throws_ok($$delete from public.generated_exports where id=(select (created->>'exportId')::uuid from archive_fixture)$$,
 '55000','export_cleanup_incomplete','current fence evidence alone cannot claim history/purge completion');
select * from finish();
rollback;
