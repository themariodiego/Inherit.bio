begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Native publication/grant proof using synthetic owner callback metadata.
-- This test does not claim an actual R2 write, ZIP producer or provider EOF.
insert into auth.users(id,email) values
 ('79800000-0000-4000-8000-000000000001','archive-test-owner@e2e.local'),
 ('79800000-0000-4000-8000-000000000002','archive-test-other@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('79800000-0000-4000-8000-000000000010','79800000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('79800000-0000-4000-8000-000000000011','79800000-0000-4000-8000-000000000002',now(),now(),'aal1');
create temporary table completion_fixture(origin jsonb,capture jsonb,created jsonb,frame jsonb,ready jsonb);
insert into completion_fixture(origin) values(jsonb_build_object('kind','account','accountId','79800000-0000-4000-8000-000000000001',
 'sessionId','79800000-0000-4000-8000-000000000010'));
-- A complete TEST request still needs the person's genuine country declaration.
select is(public.declare_jurisdiction_v2('79800000-0000-4000-8000-000000000001','79800000-0000-4000-8000-000000000010','GB',null,(select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),true)->>'jurisdiction','GB',
 'the completion fixture declares through the actual current signed country writer before capture');
-- Native TEST configuration precedes the durable complete capture; a later
-- enablement must never adopt a prior legacy request or its authority receipt.
update private.account_archive_r2_configuration set enabled=true,bucket='inherit-export-test',binding_sha256=repeat('2',64);
update completion_fixture set capture=public.export_archive_request_v1('capture',origin,'account','79800000-0000-4000-8000-000000000001');
create function pg_temp.envelope(op text,nonce text) returns jsonb language sql as $$
 select jsonb_build_object('routeId','api.export','origin','authenticated','principalId',capture->>'principalId',
 'targetKind','account','targetId','79800000-0000-4000-8000-000000000001','exportContract','account-export-v1',
 'originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt','csrfBinding',repeat('c',64),
 'operation',op,'nonceHash',nonce,'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
 'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)
 ||case when op='open-ready' then jsonb_build_object('exportId',created->>'exportId',
 'exportRevision',(created->>'exportRevision')::bigint) else '{}'::jsonb end from completion_fixture;
$$;
update completion_fixture set created=public.export_archive_request_v1('create',origin,'account','79800000-0000-4000-8000-000000000001',
 jsonb_build_object('envelope',pg_temp.envelope('create',repeat('a',64)),'exportCookieHash',repeat('9',64)),repeat('c',64));
create function pg_temp.worker(op text,payload jsonb default null) returns jsonb language sql as $$
 select public.export_archive_worker_v1(op,(created->>'exportId')::uuid,'79800000-0000-4000-8000-000000000030',capture->>'authorityReceipt',payload) from completion_fixture;
$$;
create function pg_temp.segment() returns jsonb language sql as $$
 select jsonb_build_object('ordinal',0,'offset',0,'sizeBytes',3,'sha256',repeat('d',64),
 'objectKey',capture->>'principalHash'||'/'||(created->>'exportId')||'/79800000-0000-4000-8000-000000000030-0.part') from completion_fixture;
$$;
select is(pg_temp.worker('begin')->>'attemptId','79800000-0000-4000-8000-000000000030','existing consumed account attempt starts');
select is(pg_temp.worker('reserve',pg_temp.segment())->>'ordinal','0','ordinary native reservation precedes allocation');
update completion_fixture set frame=private.reserve_account_archive_r2_write_v1('79800000-0000-4000-8000-000000000030',0,capture->>'authorityReceipt',repeat('1',64));
select is(private.complete_account_archive_r2_write_v1('79800000-0000-4000-8000-000000000030',0,
 (select capture->>'authorityReceipt' from completion_fixture),repeat('1',64),(select frame from completion_fixture),'version1','etag1'),
 (select (frame->>'objectId')::uuid from completion_fixture),'trusted owner records exact synthetic provider identity');
select is(pg_temp.worker('acknowledge',pg_temp.segment()||jsonb_build_object('objectId',(select frame->>'objectId' from completion_fixture)))->>'ordinal','0','recorded native ACK supplies exact object');
select is(pg_temp.worker('page',jsonb_build_object('page',0,'segments',jsonb_build_array(pg_temp.segment()||jsonb_build_object('objectId',(select frame->>'objectId' from completion_fixture)))))->>'page','0','complete native manifest page recorded');
create function pg_temp.manifest_hash() returns text language sql as $$
 select encode(digest(convert_to(format('[0,0,3,%s,%s,%s]%s',to_json(repeat('d',64))::text,
 to_json(pg_temp.segment()->>'objectKey')::text,to_json(frame->>'objectId')::text,chr(10)),'UTF8'),'sha256'),'hex') from completion_fixture;
$$;
select is(pg_temp.worker('bytes-complete',jsonb_build_object('sizeBytes',3,'segmentCount',1,'pageCount',1,
 'sha256',repeat('d',64),'manifestSha256',pg_temp.manifest_hash()))->>'state','bytes-complete','complete original worker counters retained');
create function pg_temp.producer() returns jsonb language sql immutable as $$
 select jsonb_build_object('version','complete-account-zip64-producer-v1','memberCount',2,'payloadBytes',1,
 'memberSha256',repeat('e',64),'manifestMemberSha256',repeat('f',64));
$$;
create function pg_temp.complete(proof jsonb default pg_temp.producer()) returns jsonb language sql as $$
 select private.complete_test_account_archive_v1('79800000-0000-4000-8000-000000000030',capture->>'authorityReceipt',proof) from completion_fixture;
$$;
select throws_ok($$update public.generated_exports set status='ready',completed_at=clock_timestamp(),expires_at=clock_timestamp()+interval '1 minute',
 archive_sha256=repeat('d',64),manifest_sha256=pg_temp.manifest_hash(),byte_count=3 where id=(select (created->>'exportId')::uuid from completion_fixture)$$,
 '55000','export_publication_not_integrated','status-only publication still refused');
select throws_ok($$select pg_temp.complete(pg_temp.producer()||'{"unproved":true}')$$,'42501','account_archive_test_unavailable','extra proof field refused');
select throws_ok($$select pg_temp.complete(pg_temp.producer()||'{"memberCount":0}')$$,'42501','account_archive_test_unavailable','incomplete producer refused');
select throws_ok($$select pg_temp.complete(pg_temp.producer()||jsonb_build_object('memberSha256',repeat('1',64)::numeric))$$,
 '42501','account_archive_test_unavailable','hash-looking numeric JSON cannot substitute for the exact string proof');
savepoint closed;
update private.account_archive_r2_configuration set enabled=false;
select throws_ok($$select pg_temp.complete()$$,'42501','account_archive_test_unavailable','closed provider refuses READY');
rollback to closed;
savepoint expired_origin;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='79800000-0000-4000-8000-000000000010';
select throws_ok($$select pg_temp.complete()$$,'42501','not_found','expired original session refuses READY');
rollback to expired_origin;
savepoint incomplete_page;
delete from private.export_archive_manifest_pages where attempt_id='79800000-0000-4000-8000-000000000030';
select throws_ok($$select pg_temp.complete()$$,'42501','account_archive_test_unavailable','missing manifest refuses READY');
rollback to incomplete_page;
select is(jsonb_array_length(private.account_archive_test_manifest_page_v1('79800000-0000-4000-8000-000000000030',
 (select capture->>'authorityReceipt' from completion_fixture),0)->'segments'),1,'owner captures all written same-version allocations');
update completion_fixture set ready=pg_temp.complete();
select is((select ready->>'status' from completion_fixture),'ready','explicit TEST owner completion reaches native READY');
select ok((select (ready->>'expiresAt')::timestamptz<= (frame->>'originalDeadline')::timestamptz from completion_fixture),'TEST READY cannot outlive original provider deadline');
select throws_ok($$select pg_temp.complete()$$,'42501','account_archive_test_unavailable','READY completion cannot replay/adopt');
select throws_ok($$update private.export_archive_attempts set account_r2_completion='{}' where id='79800000-0000-4000-8000-000000000030'$$,
 '55000','account_r2_completion_retained','native producer proof remains immutable');
select ok(not has_function_privilege(role_name,'private.complete_test_account_archive_v1(uuid,text,jsonb)','EXECUTE'),role_name||' cannot submit owner READY')
 from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role_name;
select throws_ok($$select private.current_account_archive_test_object_v1('79800000-0000-4000-8000-000000000030',0,
 (select capture->>'authorityReceipt' from completion_fixture))$$,'42501','account_archive_test_unavailable','READY without consumed download grant cannot read bytes');
select ok(not has_function_privilege('authenticated','private.account_archive_test_manifest_page_v1(uuid,text,bigint,text,jsonb)','EXECUTE'),'browser cannot enumerate owner manifest');
select is(public.export_archive_request_v1('open-ready',(select origin from completion_fixture),'account','79800000-0000-4000-8000-000000000001',
 jsonb_build_object('exportId',(select created->>'exportId' from completion_fixture),'exportCookieHash',repeat('9',64),
 'envelope',pg_temp.envelope('open-ready',repeat('b',64)),'downloadCookieHash',repeat('8',64)),repeat('c',64))->>'chunkBytes','4000000',
 'existing consumed action and cookie create genuine native download grant');
select throws_ok($$select private.current_account_archive_test_object_v1('79800000-0000-4000-8000-000000000030',0,
 (select capture->>'authorityReceipt' from completion_fixture),repeat('8',64),'{"kind":"account","accountId":"79800000-0000-4000-8000-000000000002","sessionId":"79800000-0000-4000-8000-000000000011"}')$$,
 '42501','account_archive_test_unavailable','foreign actor cannot use download');
select is(private.current_account_archive_test_object_v1('79800000-0000-4000-8000-000000000030',0,
 (select capture->>'authorityReceipt' from completion_fixture),repeat('8',64),(select origin from completion_fixture))->>'providerVersion','version1','native grant binds exact stored provider version');
-- Additive native protocol controls only. The existing synthetic owner callback
-- supplies metadata, not provider bytes or a complete ZIP. Rollback restores
-- every download field before the unchanged legacy ACK assertions below.
create temporary table new_chunk_contract_before as select to_jsonb(d) value
 from private.export_archive_downloads d where cookie_hash=repeat('8',64);
select is(private.account_archive_test_ready_v1((select origin from completion_fixture),
 (select(created->>'exportId')::uuid from completion_fixture),repeat('9',64)),
 (select ready from completion_fixture),'new polling READY returns the exact immutable15-field completion without minting an action');
select throws_ok($$select private.account_archive_test_ready_v1((select origin from completion_fixture),
 (select(created->>'exportId')::uuid from completion_fixture),repeat('7',64))$$,
 '42501','account_archive_test_unavailable','new READY independently refuses the wrong export cookie');
savepoint new_ready_missing_declaration;
update public.profiles set jurisdiction_code=null,jurisdiction_subdivision=null,jurisdiction_declared_at=null,
 jurisdiction_attestation_version=null,jurisdiction_attestation_sha256=null
 where id='79800000-0000-4000-8000-000000000001';
select throws_ok($$select private.account_archive_test_ready_v1((select origin from completion_fixture),
 (select(created->>'exportId')::uuid from completion_fixture),repeat('9',64))$$,
 '42501','account_archive_test_unavailable','a genuine ready account still needs its current personal declaration');
rollback to new_ready_missing_declaration;
savepoint new_ready_non_test;
select public.declare_jurisdiction_v2('79800000-0000-4000-8000-000000000001','79800000-0000-4000-8000-000000000010','XX',null,(select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),true);
select throws_ok($$select private.account_archive_test_ready_v1((select origin from completion_fixture),
 (select(created->>'exportId')::uuid from completion_fixture),repeat('9',64))$$,
 '42501','account_archive_test_unavailable','a real ready account cannot use the new native TEST door outside TEST');
rollback to new_ready_non_test;
savepoint new_chunk_contract;
create function pg_temp.new_chunk_context(cookie text default repeat('8',64),origin jsonb default null) returns jsonb language sql as $$
 select private.account_archive_test_delivery_context_v1((select id from private.export_archive_downloads where cookie_hash=repeat('8',64)),
 cookie,coalesce(origin,(select origin from completion_fixture))); $$;
create function pg_temp.new_chunk_receipt(op text,ordinal bigint default 0,challenge text default repeat('6',64),
 sha text default repeat('d',64),bytes bigint default 3,cookie text default repeat('8',64),origin jsonb default null)
 returns boolean language plpgsql as $$
 declare did uuid;o jsonb;
 begin
  select id into did from private.export_archive_downloads where cookie_hash=repeat('8',64);
  o:=coalesce(origin,(select completion_fixture.origin from completion_fixture));
  if op='issue' then return private.issue_account_archive_test_chunk_v1(did,cookie,o,ordinal,challenge,sha,bytes);
  elsif op='ack' then return private.ack_account_archive_test_chunk_v1(did,cookie,o,ordinal,challenge,sha,bytes);
  else raise exception 'invalid synthetic control operation';end if;
 end $$;
select is(pg_temp.new_chunk_context()->'ready',(select ready from completion_fixture),
 'current delivery context cross-binds the original cookie/account/session and entire READY');
select throws_ok($$select pg_temp.new_chunk_context(repeat('7',64))$$,
 '42501','account_archive_test_unavailable','an existing account download with wrong cookie refuses instead of falling through');
select throws_ok($$select pg_temp.new_chunk_context(origin=>'{}'::jsonb)$$,
 '42501','account_archive_test_unavailable','an existing account download with wrong origin refuses instead of falling through');
select throws_ok($$select pg_temp.new_chunk_receipt('ack')$$,
 '42501','account_archive_test_unavailable','a browser ACK cannot precede actual native chunk issuance');
select throws_ok($$select pg_temp.new_chunk_receipt('issue',sha=>repeat('e',64))$$,
 '42501','account_archive_test_unavailable','issue cannot substitute a different native segment digest');
select throws_ok($$select pg_temp.new_chunk_receipt('issue',bytes=>4)$$,
 '42501','account_archive_test_unavailable','issue cannot substitute a different native segment byte count');
select ok(pg_temp.new_chunk_receipt('issue'),'new issue records only the exact current native segment tuple');
select is((select next_sequence from private.export_archive_downloads where cookie_hash=repeat('8',64)),0::bigint,
 'provider read/issue alone does not advance the browser delivery sequence');
select throws_ok($$select pg_temp.new_chunk_receipt('issue')$$,
 '42501','account_archive_test_unavailable','an issued but unacknowledged native chunk cannot be issued again');
select throws_ok($$select pg_temp.new_chunk_receipt('ack',challenge=>repeat('7',64))$$,
 '42501','account_archive_test_unavailable','ACK independently requires the exact once-issued challenge hash');
select throws_ok($$select pg_temp.new_chunk_receipt('ack',sha=>repeat('e',64))$$,
 '42501','account_archive_test_unavailable','ACK independently requires the exact whole digest');
select throws_ok($$select pg_temp.new_chunk_receipt('ack',bytes=>4)$$,
 '42501','account_archive_test_unavailable','ACK independently requires the exact byte count');
select throws_ok($$select pg_temp.new_chunk_receipt('ack',ordinal=>1)$$,
 '42501','account_archive_test_unavailable','ACK independently requires the exact sequential ordinal');
select throws_ok($$select pg_temp.new_chunk_receipt('ack',cookie=>repeat('7',64))$$,
 '42501','account_archive_test_unavailable','ACK independently requires the original download cookie');
select throws_ok($$select pg_temp.new_chunk_receipt('ack',origin=>'{}'::jsonb)$$,
 '42501','account_archive_test_unavailable','ACK independently requires the original complete account origin');
select ok(pg_temp.new_chunk_receipt('ack'),'only the exact browser receipt advances the new native delivery sequence');
select is((select next_sequence from private.export_archive_downloads where cookie_hash=repeat('8',64)),1::bigint,
 'one consumed receipt advances exactly once');
select throws_ok($$select pg_temp.new_chunk_receipt('ack')$$,
 '42501','account_archive_test_unavailable','a consumed exact receipt cannot replay');
rollback to new_chunk_contract;
select is((select to_jsonb(d) from private.export_archive_downloads d where cookie_hash=repeat('8',64)),
 (select value from new_chunk_contract_before),'all new receipt controls restore the entire exact legacy download row');
select ok(private.ack_test_account_archive_download_v1('79800000-0000-4000-8000-000000000030',0,
 (select capture->>'authorityReceipt' from completion_fixture),repeat('8',64),(select origin from completion_fixture)),'exact sequential native download ACK');
select throws_ok($$select private.current_account_archive_test_object_v1('79800000-0000-4000-8000-000000000030',0,
 (select capture->>'authorityReceipt' from completion_fixture),repeat('8',64),(select origin from completion_fixture))$$,
 '42501','account_archive_test_unavailable','download chunk cannot replay');
select * from finish();
rollback;
