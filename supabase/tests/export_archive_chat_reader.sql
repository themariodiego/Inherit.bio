begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic, rollback-only. Two real turns are committed through the canonical
-- Copilot protocol; every other message copies a real committed row, changing
-- only its chat, ordinal and (for the stale turn) its data projection. No model
-- endpoint is contacted.
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',65536,65536,262144,2)
 on conflict(singleton) do update set auth_issuer=excluded.auth_issuer;
insert into auth.users(id,email) values
 ('79a00000-0000-4000-8000-000000000001','chat-owner@e2e.local'),
 ('79a00000-0000-4000-8000-000000000002','chat-other@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('79a00000-0000-4000-8000-000000000010','79a00000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('79a00000-0000-4000-8000-000000000011','79a00000-0000-4000-8000-000000000002',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='79a00000-0000-4000-8000-000000000001';
create temporary table self_subject as select subject_account_id account,id from public.subjects
 where subject_account_id in ('79a00000-0000-4000-8000-000000000001','79a00000-0000-4000-8000-000000000002') and subject_class='self';
create function pg_temp.subject_of(who uuid) returns uuid language sql as $$ select id from self_subject where account=who $$;
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'79a00000-0000-4000-8000-000000000001','79a00000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('79a00000-0000-4000-8000-000000000001','79a00000-0000-4000-8000-000000000010',
 pg_temp.subject_of('79a00000-0000-4000-8000-000000000001'),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('79a00000-0000-4000-8000-000000000001','79a00000-0000-4000-8000-000000000010',
 pg_temp.subject_of('79a00000-0000-4000-8000-000000000001'),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));

\ir fixtures/own_copilot_synthetic_settings.inc
select public.save_own_copilot_settings_v1('79a00000-0000-4000-8000-000000000001','79a00000-0000-4000-8000-000000000010',
 pg_temp.synthetic_copilot_settings('synthetic-model','cloud'),null,repeat('b',64),null);
create temporary table presentation as select public.own_copilot_presentation_v1('79a00000-0000-4000-8000-000000000001',
 '79a00000-0000-4000-8000-000000000010',pg_temp.subject_of('79a00000-0000-4000-8000-000000000001')) value;
create temporary table chat_authority as select public.grant_own_copilot_v1('79a00000-0000-4000-8000-000000000001',
 '79a00000-0000-4000-8000-000000000010',pg_temp.subject_of('79a00000-0000-4000-8000-000000000001'),
 (select value->'snapshot' from presentation),(select value->'artifacts' from presentation),repeat('c',64),
 clock_timestamp()+interval '9 minutes') value;
create function pg_temp.chat(op text,payload jsonb default '{}',chat_id uuid default null,expected_projection jsonb default null) returns jsonb language sql as $$
 select public.own_copilot_chat_v1(op,'79a00000-0000-4000-8000-000000000001','79a00000-0000-4000-8000-000000000010',
 pg_temp.subject_of('79a00000-0000-4000-8000-000000000001'),(select value from chat_authority),expected_projection,chat_id,payload);
$$;
create temporary table chat_projection as select pg_temp.chat('prepare') value;
create function pg_temp.turn(nonce text,chat_id uuid default null,last_ordinal integer default 0) returns jsonb language plpgsql as $$
begin
 if chat_id is null then
  perform pg_temp.chat('begin',jsonb_build_object('nonceHash',nonce,'expiresAt',clock_timestamp()+interval '9 minutes'),null,(select value from chat_projection));
 end if;
 return pg_temp.chat('commit',jsonb_build_object('message','Synthetic question','answer','Synthetic answer','citations','[]'::jsonb,
  'lastOrdinal',last_ordinal,'nonceHash',nonce),chat_id,(select value from chat_projection));
end $$;

-- The other account has its own valid Copilot conversation, made the same
-- real way, which the owner's export must never contain.
update public.profiles set date_of_birth=date '1985-01-01' where id='79a00000-0000-4000-8000-000000000002';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'79a00000-0000-4000-8000-000000000002','79a00000-0000-4000-8000-000000000011',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['4','5']) letter;
select public.sign_own_upload_artifact_v1('79a00000-0000-4000-8000-000000000002','79a00000-0000-4000-8000-000000000011',
 pg_temp.subject_of('79a00000-0000-4000-8000-000000000002'),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('4',64));
select public.sign_own_upload_artifact_v1('79a00000-0000-4000-8000-000000000002','79a00000-0000-4000-8000-000000000011',
 pg_temp.subject_of('79a00000-0000-4000-8000-000000000002'),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('5',64));
select public.save_own_copilot_settings_v1('79a00000-0000-4000-8000-000000000002','79a00000-0000-4000-8000-000000000011',
 pg_temp.synthetic_copilot_settings('synthetic-model','cloud'),null,repeat('6',64),null);
create temporary table other_presentation as select public.own_copilot_presentation_v1('79a00000-0000-4000-8000-000000000002',
 '79a00000-0000-4000-8000-000000000011',pg_temp.subject_of('79a00000-0000-4000-8000-000000000002')) value;
create temporary table other_authority as select public.grant_own_copilot_v1('79a00000-0000-4000-8000-000000000002',
 '79a00000-0000-4000-8000-000000000011',pg_temp.subject_of('79a00000-0000-4000-8000-000000000002'),
 (select value->'snapshot' from other_presentation),(select value->'artifacts' from other_presentation),repeat('7',64),
 clock_timestamp()+interval '9 minutes') value;
create function pg_temp.other_chat(op text,payload jsonb default '{}',expected_projection jsonb default null) returns jsonb language sql as $$
 select public.own_copilot_chat_v1(op,'79a00000-0000-4000-8000-000000000002','79a00000-0000-4000-8000-000000000011',
 pg_temp.subject_of('79a00000-0000-4000-8000-000000000002'),(select value from other_authority),expected_projection,null,payload);
$$;
create temporary table other_projection as select pg_temp.other_chat('prepare') value;
select pg_temp.other_chat('begin',jsonb_build_object('nonceHash',repeat('8',64),'expiresAt',clock_timestamp()+interval '9 minutes'),
 (select value from other_projection));
create temporary table other_chat as select (pg_temp.other_chat('commit',jsonb_build_object('message','Other question',
 'answer','Other answer','citations','[]'::jsonb,'lastOrdinal',0,'nonceHash',repeat('8',64)),(select value from other_projection))->>'chatId')::uuid id;

-- Chat A: two real turns, then a turn under a projection that no longer
-- holds, then a later valid turn that depends on it.
create temporary table chat_a as select (pg_temp.turn(repeat('d',64))->>'chatId')::uuid id;
select pg_temp.turn(null,(select id from chat_a),1);
select is((select count(*) from public.chat_messages where chat_id=(select id from chat_a)),4::bigint,'fixture: two real turns');
create temporary table template as select * from public.chat_messages where chat_id=(select id from chat_a) and turn_ordinal=1;
create function pg_temp.add_turn(target uuid,ordinal bigint,projection jsonb default null) returns void language sql as $$
 insert into public.chat_messages(chat_id,user_id,role,content,turn_id,turn_ordinal,paired_role,scope_revision,authorization_fingerprint,
  retrieved_subject_ids,retrieved_purpose_keys,contributor_ids,grant_revisions,lifecycle_revisions,provider_classification,
  runtime_attestation_revision,model_recipient_revision,legacy_unverified,canonical_projection,canonical_citations,citation_ids)
 select target,t.user_id,t.role,jsonb_build_array(jsonb_build_object('type','text','text','Synthetic turn '||ordinal)),
  md5(target::text||ordinal)::uuid,ordinal,t.paired_role,t.scope_revision,t.authorization_fingerprint,t.retrieved_subject_ids,
  t.retrieved_purpose_keys,t.contributor_ids,t.grant_revisions,t.lifecycle_revisions,t.provider_classification,
  t.runtime_attestation_revision,t.model_recipient_revision,false,coalesce(projection,t.canonical_projection),t.canonical_citations,t.citation_ids
 from template t;
$$;
select pg_temp.add_turn((select id from chat_a),3,'{"sources":[{"id":"stale"}],"legacySources":[],"unavailableSources":[]}');
select pg_temp.add_turn((select id from chat_a),4);
-- Chat B: one real turn and 105 more, so its messages cross a page.
create temporary table chat_b as select (pg_temp.turn(repeat('f',64))->>'chatId')::uuid id;
select pg_temp.add_turn((select id from chat_b),n) from generate_series(2,106) n;
-- 101 more chats with one turn each, so the chat list crosses a page.
insert into public.chats(id,user_id,scope_kind,subject_id,lifecycle_revision,provider_classification,runtime_attestation_revision,
 model_recipient_revision,authorization_fingerprint,legacy_unverified,canonical_authority)
 select format('79a10000-0000-4000-8000-%s',lpad(n::text,12,'0'))::uuid,c.user_id,c.scope_kind,c.subject_id,c.lifecycle_revision,
  c.provider_classification,c.runtime_attestation_revision,c.model_recipient_revision,c.authorization_fingerprint,false,c.canonical_authority
 from public.chats c,generate_series(1,101) n where c.id=(select id from chat_a);
select pg_temp.add_turn(format('79a10000-0000-4000-8000-%s',lpad(n::text,12,'0'))::uuid,1) from generate_series(1,101) n;
-- Not exportable: a legacy unverified chat, a chat whose Copilot grant
-- revision is no longer current, and another account's chat.
insert into public.chats(id,user_id,scope_kind,subject_id,lifecycle_revision,provider_classification,runtime_attestation_revision,
 model_recipient_revision,authorization_fingerprint,legacy_unverified,canonical_authority)
 select v.id,v.owner,c.scope_kind,pg_temp.subject_of(v.owner),c.lifecycle_revision,c.provider_classification,c.runtime_attestation_revision,
  c.model_recipient_revision,c.authorization_fingerprint,v.legacy,
  case when v.stale then c.canonical_authority||jsonb_build_object('copilotGrantRevision',999) else c.canonical_authority end
 from public.chats c,(values ('79a20000-0000-4000-8000-000000000001'::uuid,'79a00000-0000-4000-8000-000000000001'::uuid,true,false),
  ('79a20000-0000-4000-8000-000000000002'::uuid,'79a00000-0000-4000-8000-000000000001'::uuid,false,true),
  ('79a20000-0000-4000-8000-000000000003'::uuid,'79a00000-0000-4000-8000-000000000002'::uuid,false,false)) v(id,owner,legacy,stale)
 where c.id=(select id from chat_a);
select pg_temp.add_turn(id,1) from (values ('79a20000-0000-4000-8000-000000000001'::uuid),('79a20000-0000-4000-8000-000000000002'::uuid)) v(id);
-- Only the chat itself is marked legacy, so the chat-level rule alone excludes it.
insert into public.chat_messages(chat_id,user_id,role,content,turn_id,turn_ordinal,paired_role,scope_revision,authorization_fingerprint,
 retrieved_subject_ids,retrieved_purpose_keys,contributor_ids,grant_revisions,lifecycle_revisions,provider_classification,
 runtime_attestation_revision,model_recipient_revision,legacy_unverified,canonical_projection,canonical_citations,citation_ids)
 select '79a20000-0000-4000-8000-000000000003','79a00000-0000-4000-8000-000000000002',role,content,md5('other')::uuid,1,paired_role,
  scope_revision,authorization_fingerprint,array[pg_temp.subject_of('79a00000-0000-4000-8000-000000000002')],retrieved_purpose_keys,
  array['79a00000-0000-4000-8000-000000000002'::uuid],grant_revisions,lifecycle_revisions,provider_classification,
  runtime_attestation_revision,model_recipient_revision,false,canonical_projection,canonical_citations,citation_ids from template;

-- An account export and a subject export for the owner, through the real RPCs.
create temporary table chat_job(label text primary key,origin jsonb,target_kind text,target uuid,route text,contract text,
 capture jsonb,created jsonb,attempt uuid);
insert into chat_job values
 ('account',jsonb_build_object('kind','account','accountId','79a00000-0000-4000-8000-000000000001','sessionId','79a00000-0000-4000-8000-000000000010'),
  'account','79a00000-0000-4000-8000-000000000001','api.export','account-export-v1',null,null,'79a00000-0000-4000-8000-000000000050'),
 ('subject',jsonb_build_object('kind','account','accountId','79a00000-0000-4000-8000-000000000001','sessionId','79a00000-0000-4000-8000-000000000010'),
  'subject',pg_temp.subject_of('79a00000-0000-4000-8000-000000000001'),'api.subject-export','subject-export-v1',null,null,
  '79a00000-0000-4000-8000-000000000051');
create function pg_temp.open_job(which text,nonce text) returns void language plpgsql as $$
declare r record;
begin
 select * into r from chat_job where label=which;
 update chat_job set capture=public.export_archive_request_v1('capture',r.origin,r.target_kind,r.target) where label=which;
 select * into r from chat_job where label=which;
 update chat_job set created=public.export_archive_request_v1('create',r.origin,r.target_kind,r.target,jsonb_build_object(
  'envelope',jsonb_build_object('routeId',r.route,'origin','authenticated','principalId',r.capture->>'principalId',
   'targetKind',r.target_kind,'targetId',r.target,'exportContract',r.contract,'originBinding',r.capture->>'originBinding',
   'authorityReceipt',r.capture->>'authorityReceipt','csrfBinding',repeat('c',64),'operation','create','nonceHash',nonce,
   'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
   'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000),
  'exportCookieHash',nonce),repeat('c',64)) where label=which;
 select * into r from chat_job where label=which;
 perform public.export_archive_worker_v1('begin',(r.created->>'exportId')::uuid,r.attempt,r.capture->>'authorityReceipt');
end $$;
create function pg_temp.read(which text,op text,payload jsonb) returns jsonb language sql as $$
 select public.export_archive_content_v1(op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',payload)
 from chat_job where label=which;
$$;
create function pg_temp.messages(chat uuid,after_ordinal bigint default 0,which text default 'account') returns jsonb language sql as $$
 select pg_temp.read(which,'chat-messages',jsonb_build_object('chatId',chat,'afterOrdinal',after_ordinal));
$$;
create function pg_temp.state() returns jsonb language sql as $$
 select jsonb_build_object('jobs',(select jsonb_agg(to_jsonb(j) order by j.export_id) from private.export_archive_jobs j),
  'attempts',(select jsonb_agg(to_jsonb(a) order by a.id) from private.export_archive_attempts a),
  'exports',(select jsonb_agg(to_jsonb(e) order by e.id) from public.generated_exports e),
  'nonces',(select count(*) from private.export_archive_nonce_uses),
  'chats',(select count(*) from public.chats),'messages',(select count(*) from public.chat_messages));
$$;
select pg_temp.open_job('account',repeat('a',64));
select pg_temp.open_job('subject',repeat('b',64));
create temporary table before_reads as select pg_temp.state() value;

-- The chat list: every exportable chat once, in id order, across two pages.
create temporary table chat_pages(n integer,value jsonb);
insert into chat_pages values(1,pg_temp.read('account','chats','{"afterChatId":null}'));
insert into chat_pages values(2,pg_temp.read('account','chats',jsonb_build_object('afterChatId',(select value->'nextAfterChatId' from chat_pages where n=1))));
select is((select jsonb_array_length(value->'chats') from chat_pages where n=1),100,'the first chat page is bounded at 100');
select is((select jsonb_array_length(value->'chats') from chat_pages where n=2),3,'the second page holds the remainder');
select is((select value->'nextAfterChatId' from chat_pages where n=2),'null'::jsonb,'the last chat page has no cursor');
create temporary table listed as select (c->>'id')::uuid id,c from chat_pages,jsonb_array_elements(value->'chats') c;
select is((select count(distinct id) from listed),103::bigint,'103 exportable chats, none twice');
select ok((select bool_and(id in (select id from chat_a union select id from chat_b) or id::text like '79a10000%') from listed),
 'only the owner''s valid chats are listed');
select ok(not exists(select 1 from listed where id::text like '79a20000%'),
 'the legacy chat, the stale-grant chat and the other account''s chat are not listed');
select is((select (c->>'message_count')::integer from listed where id=(select id from chat_a)),4,
 'chat A counts only the turns before its stale one');
select is((select (c->>'message_count')::integer from listed where id=(select id from chat_b)),212,'chat B counts all 106 turns');
select is((select array_agg(k order by k) from listed,jsonb_object_keys(c) k where id=(select id from chat_a)),
 array['created_at','id','message_count','scope_kind','subject_id'],'a listed chat carries exactly its worker fields');

-- Messages: the valid prefix only, in history order, with the closed history fields.
select is(jsonb_array_length(pg_temp.messages((select id from chat_a))->'messages'),4,'chat A exports its first two turns');
select is((select jsonb_agg(m->>'role') from jsonb_array_elements(pg_temp.messages((select id from chat_a))->'messages') m),
 '["user","assistant","user","assistant"]'::jsonb,'each turn reads question then answer');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.messages((select id from chat_a))->'messages') m
 where m->'content' @> '[{"text":"Synthetic turn 3"}]' or m->'content' @> '[{"text":"Synthetic turn 4"}]'),
 'the stale turn and the later turn that depends on it are omitted whole');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.messages((select id from chat_a))->'messages'->0) k),
 array['citations','content','createdAt','embryoFindings','id','role'],'a message carries exactly the history fields');
select is(pg_temp.messages((select id from chat_a))->'nextAfterOrdinal','null'::jsonb,'a short chat has no message cursor');
create temporary table b_pages(n integer,value jsonb);
insert into b_pages values(1,pg_temp.messages((select id from chat_b)));
insert into b_pages values(2,pg_temp.messages((select id from chat_b),(select (value->>'nextAfterOrdinal')::bigint from b_pages where n=1)));
select is((select jsonb_array_length(value->'messages') from b_pages where n=1),200,'the first message page holds 100 turns');
select is((select jsonb_array_length(value->'messages') from b_pages where n=2),12,'the second holds the remaining six turns');
select is((select value->'nextAfterOrdinal' from b_pages where n=2),'null'::jsonb,'and ends the chat');
select is((select count(distinct m->>'id') from b_pages,jsonb_array_elements(value->'messages') m),212::bigint,
 'every message of chat B exactly once');
select throws_ok($$select pg_temp.messages('79a20000-0000-4000-8000-000000000001')$$,'42501','not_found','a legacy chat is not readable');
select throws_ok($$select pg_temp.messages('79a20000-0000-4000-8000-000000000002')$$,'42501','not_found','a stale-grant chat is not readable');
select throws_ok($$select pg_temp.messages('79a20000-0000-4000-8000-000000000003')$$,'42501','not_found','another account''s chat is not readable');
select throws_ok($$select pg_temp.messages('79a30000-0000-4000-8000-000000000009')$$,'42501','not_found','an unknown chat is not readable');
select ok(not exists(select 1 from listed where id=(select id from other_chat)),'the other account''s real conversation is not listed');
select throws_ok($$select pg_temp.messages((select id from other_chat))$$,'42501','not_found','and is not readable by id');
select is(jsonb_array_length(pg_temp.read('subject','chats','{"afterChatId":null}')->'chats'),100,
 'a subject export lists the same chats about its subject');

-- Closed payloads.
select throws_ok($$select pg_temp.read('account','chats','{}')$$,'22023','invalid_request','the list needs a cursor');
select throws_ok($$select pg_temp.read('account','chats','{"afterChatId":null,"limit":500}')$$,'22023','invalid_request','no caller-chosen page size');
select throws_ok($$select pg_temp.read('account','chat-messages','{"chatId":"not-a-uuid","afterOrdinal":0}')$$,'22023','invalid_request','a malformed chat id is refused');
select throws_ok($$select pg_temp.read('account','chat-messages',jsonb_build_object('chatId',(select id from chat_a),'afterOrdinal',-1))$$,
 '22023','invalid_request','a negative ordinal is refused');
select throws_ok($$select pg_temp.read('account','chat-messages',jsonb_build_object('chatId',(select id from chat_a)))$$,
 '22023','invalid_request','the message cursor is required');

select is(pg_temp.state(),(select value from before_reads),'chat reads leave jobs, attempts, exports, nonces, chats and messages unchanged');

-- A message added after capture fails the job; a revoked Copilot grant does
-- too, as does deleting the provider settings, which supersedes that grant.
savepoint drift;
select pg_temp.add_turn((select id from chat_b),107);
select throws_ok($$select pg_temp.read('account','chats','{"afterChatId":null}')$$,'42501','not_found','a message added after capture fails the job');
rollback to savepoint drift;
update public.purpose_grants set revoked_at=clock_timestamp(),revocation_reason='revoked' where grant_id=((select value->>'copilotGrantId' from chat_authority))::uuid;
select throws_ok($$select pg_temp.messages((select id from chat_a))$$,'42501','not_found','a Copilot grant revoked after capture fails the job');
rollback to savepoint drift;
delete from public.llm_settings where user_id='79a00000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.read('account','chats','{"afterChatId":null}')$$,'42501','not_found',
 'deleting the provider settings after capture fails the job');
rollback to savepoint drift;

-- The helper is internal: no browser or service role calls it directly.
select ok(not has_function_privilege('authenticated','private.export_archive_chat_messages_v1(uuid,uuid,uuid,bigint,integer)','execute'),
 'authenticated cannot call the chat helper');
select ok(not has_function_privilege('service_role','private.export_archive_chat_messages_v1(uuid,uuid,uuid,bigint,integer)','execute'),
 'service_role cannot call the chat helper directly');

select * from finish();
rollback;
