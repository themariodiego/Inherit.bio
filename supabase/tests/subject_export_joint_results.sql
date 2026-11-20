begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- api.subject-export, step two (20261023100000_subject_export_joint_results.sql),
-- owner decision of 16 October 2026: joint results are included only while
-- each other contributor's permission is live. A Portrait result naming the
-- record leaves only while the other parent's Portrait permission holds, with
-- the record's own fields only; a family pair no longer refuses the record.
-- Since 20261023110000_export_completeness.sql (owner decisions of 23
-- October) a family group conversation is projected under the same
-- live-grant rule (subject_export_family_conversations.sql) and a cohort role
-- no longer refuses (export_cohort_records.sql); a canonical conversation
-- anchored on the record's pair is the one joint result that still refuses
-- with the stated reason.
--
-- Every request, job, attempt, grant, pair, pause and acknowledgement here is
-- produced by the current doors. There is no Portrait writer, so the
-- portrait_results rows, the chats and the forged states named "planted" are
-- synthetic owner-only fixtures. Everything rolls back.
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
\ir fixtures/account_archive_ordinary_scientific.inc

-- B is the other parent; C is a third account the requester never shares with.
do $$ declare n integer; begin
 for n in 1..2 loop
  insert into auth.users(id,email,email_confirmed_at) values(('7a560000-0000-4000-8000-00000000000'||n)::uuid,'joint-results-'||n||'@e2e.local',now());
  insert into auth.sessions(id,user_id,created_at,updated_at,aal) values(('7a560000-0000-4000-8000-00000000001'||n)::uuid,
   ('7a560000-0000-4000-8000-00000000000'||n)::uuid,now(),now(),'aal1');
  update public.profiles set date_of_birth='1990-01-01' where id=('7a560000-0000-4000-8000-00000000000'||n)::uuid;
 end loop;
end $$;
create temporary table jr(label text primary key,account uuid,session uuid,subject uuid,principal uuid);
insert into jr(label,account,session) values
 ('a','77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010'),
 ('b','7a560000-0000-4000-8000-000000000001','7a560000-0000-4000-8000-000000000011'),
 ('c','7a560000-0000-4000-8000-000000000002','7a560000-0000-4000-8000-000000000012');
update jr set subject=s.id from public.subjects s where s.subject_account_id=jr.account and s.subject_class='self';
update jr set principal=p.id from public.subject_principals p where p.subject_id=jr.subject and p.account_id=jr.account
 and p.principal_kind='account_subject' and p.status='active';
create function pg_temp.v(which text,col text) returns uuid language sql stable as $$
 select case col when 'account' then account when 'session' then session when 'subject' then subject else principal end from jr where label=which;
$$;
select ok((select count(*)=3 and bool_and(subject is not null and principal is not null) from jr),'three real accounts with their own records');
select public.mark_independent_login_v1(account,session) from jr;

-- The real Portrait grants, both directions, and both acknowledgements.
create function pg_temp.grant_portrait(owner text,recipient text,nonce text) returns uuid language sql as $$
 select public.grant_family_portrait_purpose_v1(pg_temp.v(owner,'account'),pg_temp.v(owner,'session'),pg_temp.v(owner,'subject'),
  pg_temp.v(recipient,'principal'),pg_temp.v(recipient,'account'),'family.portrait',1,
  (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),nonce,
  public.family_portrait_grant_presentation_v1(pg_temp.v(owner,'account'),pg_temp.v(owner,'session'),pg_temp.v(owner,'subject'),
   pg_temp.v(recipient,'account')));
$$;
create temporary table portrait_grants as select 'a'::text owner,pg_temp.grant_portrait('a','b','joint-results-portrait-a') grant_id;
insert into portrait_grants select 'b',pg_temp.grant_portrait('b','a','joint-results-portrait-b');
select public.acknowledge_portrait_v1(pg_temp.v('a','account'),pg_temp.v('a','subject'));
select public.acknowledge_portrait_v1(pg_temp.v('b','account'),pg_temp.v('b','subject'));
create function pg_temp.pair() returns uuid language sql stable as $$
 select id from public.family_pairs where subject_low_id=least(pg_temp.v('a','subject'),pg_temp.v('b','subject'))
  and subject_high_id=greatest(pg_temp.v('a','subject'),pg_temp.v('b','subject'));
$$;
select is((select status from public.family_pairs where id=pg_temp.pair()),'current','the real grants create one current pair');
select ok(private.family_portrait_authority_v1(pg_temp.v('a','account'),pg_temp.v('a','session'),pg_temp.pair(),pg_temp.v('b','account')) is not null,
 'Portrait is live between the two parents');

-- Synthetic Portrait results (no writer ships). Two are the pair's own; the
-- planted ones are another pair's result that the requester holds, and a
-- result naming the requester but filed under that other pair.
insert into public.family_pairs(id,subject_a_id,subject_b_id,status)
 values('7a560000-0000-4000-8000-0000000000f1',pg_temp.v('b','subject'),pg_temp.v('c','subject'),'current');
insert into public.portrait_results(id,owner_account_id,parent_a_subject_id,parent_b_subject_id,family_pair_id,kind,trait_key,result,coverage,
 method_version,source_binding_fingerprint,computation_revision) values
 ('7a560000-0000-4000-8000-000000000101',pg_temp.v('b','account'),pg_temp.v('a','subject'),pg_temp.v('b','subject'),pg_temp.pair(),
  'carrier_pair','synthetic-carrier','{"band":"one-in-four","covered":true}',0.75,'synthetic-portrait-v1',repeat('9',64),1),
 ('7a560000-0000-4000-8000-000000000102',pg_temp.v('a','account'),pg_temp.v('b','subject'),pg_temp.v('a','subject'),pg_temp.pair(),
  'polygenic_distribution','synthetic-height','{"distribution":[0.1,0.8,0.1]}',0.5,'synthetic-portrait-v1',repeat('8',64),1),
 ('7a560000-0000-4000-8000-000000000103',pg_temp.v('a','account'),pg_temp.v('b','subject'),pg_temp.v('c','subject'),
  '7a560000-0000-4000-8000-0000000000f1','carrier_pair','planted-foreign-pair','{"band":"planted"}',1,'synthetic-portrait-v1',repeat('7',64),1),
 ('7a560000-0000-4000-8000-000000000104',pg_temp.v('b','account'),pg_temp.v('a','subject'),pg_temp.v('b','subject'),
  '7a560000-0000-4000-8000-0000000000f1','carrier_pair','planted-wrong-pair','{"band":"planted"}',1,'synthetic-portrait-v1',repeat('6',64),1);

create temporary table sx(label text primary key,origin jsonb,target_kind text,subject uuid,capture jsonb,created jsonb,attempt uuid);
insert into sx(label,origin,target_kind,subject,attempt) values
 ('subject',jsonb_build_object('kind','account','accountId',pg_temp.v('a','account'),'sessionId',pg_temp.v('a','session')),'subject',pg_temp.v('a','subject'),
  '7a560000-0000-4000-8000-000000000201'),
 ('account',jsonb_build_object('kind','account','accountId',pg_temp.v('a','account'),'sessionId',pg_temp.v('a','session')),'account',pg_temp.v('a','account'),
  '7a560000-0000-4000-8000-000000000202');
grant select,update on sx to service_role;grant select on jr,portrait_grants,normalization_subject,export_snapshot to service_role;
create function pg_temp.envelope(which text,op text,nonce text) returns jsonb language sql as $$
 select jsonb_build_object('routeId',case when target_kind='account' then 'api.export' else 'api.subject-export' end,
  'origin','authenticated','principalId',capture->>'principalId','targetKind',target_kind,'targetId',subject,
  'exportContract',case when target_kind='account' then 'account-export-v1' else 'subject-export-v1' end,
  'originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt','csrfBinding',repeat('c',64),
  'operation',op,'nonceHash',nonce,'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
  'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000) from sx where label=which;
$$;
create function pg_temp.request(which text,op text,payload jsonb default null,csrf text default null) returns jsonb language sql as $$
 select case when target_kind='subject' then public.subject_export_request_v1(op,origin,subject,payload,csrf)
  else public.export_archive_request_v1(op,origin,'account',subject,payload,csrf) end from sx where label=which;
$$;
create function pg_temp.classes(which text,op text,kind text default null) returns jsonb language sql as $$
 select public.export_archive_account_classes_v1(op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',kind,null) from sx where label=which;
$$;
create function pg_temp.graph(which text,kind text) returns jsonb language sql as $$
 select public.export_archive_account_graph_rows_v2((created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',kind,null) from sx where label=which;
$$;
-- The class entry of one kind in the record's current capture, read as the owner.
create function pg_temp.entry(kind text) returns jsonb language sql as $$
 select x from sx,jsonb_array_elements(private.export_account_owned_capture_v1(origin,'subject',subject)->'classInventory')x
 where label='subject' and x->>'kind'=kind;
$$;
-- The rows the record's export would carry, read as the owner.
create function pg_temp.portrait_rows() returns setof jsonb language sql as $$
 select jsonb_build_object('id',x.projected_id,'subjectId',x.projected_subject,'row',x.projected_row)
 from sx,private.export_subject_portrait_rows_v1(origin,subject)x where label='subject' order by x.projected_id;
$$;
-- Leak verdicts, used on the real projection and again on each planted copy.
create function pg_temp.exported_ids() returns uuid[] language sql as $$
 select coalesce(array_agg((r->>'id')::uuid order by r->>'id'),'{}') from pg_temp.portrait_rows() r;
$$;
create function pg_temp.counterparty_values() returns text[] language sql as $$
 select coalesce(array_agg(distinct v order by v),'{}') from pg_temp.portrait_rows() r,
  unnest(array[pg_temp.v('b','subject')::text,pg_temp.v('b','account')::text,pg_temp.v('a','account')::text,
   pg_temp.v('c','subject')::text,pg_temp.v('c','account')::text,pg_temp.v('a','subject')::text,repeat('9',64),repeat('8',64)]) v
  where (r->'row')::text like '%'||v||'%';
$$;
create function pg_temp.forbidden_keys() returns text[] language sql as $$
 select coalesce(array_agg(distinct k order by k),'{}') from pg_temp.portrait_rows() r,jsonb_object_keys(r->'row') k
 where k not in('id','family_pair_id','kind','trait_key','result','coverage','method_version','computation_revision','computed_at');
$$;

-- 1. The record exports with its live joint results.
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update sx set capture=pg_temp.request(label,'capture') where label='subject';
select is((select capture->'subjectPartitions' from sx where label='subject'),jsonb_build_array(pg_temp.v('a','subject')),
 'a record in a current Portrait pair is captured, no longer refused');
select throws_ok($$select pg_temp.request('account','capture')$$,'0A000','export_partition_projection_unavailable',
 'the whole-account export still refuses while another person''s grant to the account is current');
reset role;
select is(pg_temp.entry('portrait_results')->>'mode','joint-results','Portrait results are the record''s joint-results class');
select is((pg_temp.entry('portrait_results')->>'rows')::bigint,2::bigint,'exactly the pair''s two live results are counted');
select is(pg_temp.entry('portrait_results')->'partitions',jsonb_build_array(jsonb_build_object('subjectId',pg_temp.v('a','subject'),'rows',2)),
 'both are filed in the record''s own partition');
select is(pg_temp.exported_ids(),array['7a560000-0000-4000-8000-000000000101','7a560000-0000-4000-8000-000000000102']::uuid[],
 'another pair''s result and a result filed under another pair never appear');
select is(pg_temp.forbidden_keys(),'{}'::text[],'a result carries only the record''s nine fields');
select is(pg_temp.counterparty_values(),'{}'::text[],
 'no account id, parent subject id or source fingerprint appears anywhere in an exported result');
select is((select r->'row' from pg_temp.portrait_rows() r where r->>'id'='7a560000-0000-4000-8000-000000000101'),
 jsonb_build_object('id','7a560000-0000-4000-8000-000000000101','family_pair_id',pg_temp.pair(),'kind','carrier_pair','trait_key','synthetic-carrier',
  'result','{"band":"one-in-four","covered":true}'::jsonb,'coverage',0.75,'method_version','synthetic-portrait-v1','computation_revision',1,
  'computed_at',(select computed_at from public.portrait_results where id='7a560000-0000-4000-8000-000000000101')),
 'the projected row is the stored result, verbatim, with the record''s own fields');
select is((pg_temp.entry('family_pairs')->>'rows')::bigint,1::bigint,'the record''s own pair is its one graph row; the other pair is not');
select is((select (x->>'rows')::bigint from sx,jsonb_array_elements(private.export_account_owned_capture_v1(origin,'subject',subject)#>'{readableGraph,inventory}')x
 where label='subject' and x->>'kind'='embryo_cohorts'),0::bigint,'no cohort row is routed to the record');
select throws_ok($$select private.export_subject_class_inventory_v1(pg_temp.v('a','account'),
 private.export_account_owned_capture_v1(origin,'subject',subject)||jsonb_build_object('origin',
  jsonb_build_object('kind','account','accountId',pg_temp.v('b','account'),'sessionId',pg_temp.v('b','session')))) from sx where label='subject'$$,
 '42501','not_found','the record''s inventory never reads Portrait results under another account''s origin');
select throws_ok($$select private.export_subject_class_inventory_v1(pg_temp.v('a','account'),
 private.export_account_owned_capture_v1(origin,'subject',subject)-'origin') from sx where label='subject'$$,
 '42501','not_found','nor without the job''s origin');
select throws_ok($$select * from private.export_subject_portrait_rows_v1((select origin from sx where label='subject'),pg_temp.v('b','subject'))$$,
 '42501','not_found','the projection refuses a record that is not the caller''s own');

-- 2. The real job reads the same rows through the classes door.
set local role service_role;
update sx set created=pg_temp.request(label,'create',jsonb_build_object('envelope',pg_temp.envelope(label,'create',repeat('a',64)),
 'exportCookieHash',repeat('9',64)),repeat('c',64)) where label='subject';
select lives_ok('set constraints all immediate','the genuine request flushes every deferred creation invariant');
set constraints all deferred;
select lives_ok($$select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from sx where label='subject'$$,
 'the durable worker begins the record''s attempt');
select is((select x from jsonb_array_elements(pg_temp.classes('subject','context')->'classes')x where x->>'kind'='portrait_results')->>'mode',
 'joint-results','the job''s class context carries the joint-results class');
select is((select jsonb_agg(r->>'id' order by r->>'id') from jsonb_array_elements(pg_temp.classes('subject','metadata','portrait_results')->'rows')r),
 '["7a560000-0000-4000-8000-000000000101","7a560000-0000-4000-8000-000000000102"]'::jsonb,'the door pages exactly the two live results');
select ok((select bool_and(r->>'subjectId'=pg_temp.v('a','subject')::text) from jsonb_array_elements(pg_temp.classes('subject','metadata','portrait_results')->'rows')r),
 'every paged result is the record''s');
select ok((select bool_and(r->>'rowText' not like '%'||pg_temp.v('b','subject')::text||'%' and r->>'rowText' not like '%'||pg_temp.v('b','account')::text||'%'
 and r->>'rowText' not like '%'||repeat('9',64)||'%') from jsonb_array_elements(pg_temp.classes('subject','metadata','portrait_results')->'rows')r),
 'no paged result names the other parent or a source fingerprint');
select ok((select bool_and(r->>'rowText' not like '%'||pg_temp.v('b','subject')::text||'%' and r->>'rowText' not like '%'||pg_temp.v('a','subject')::text||'%')
 and count(*)=1 from jsonb_array_elements(pg_temp.graph('subject','family_pairs')->'rows')r),
 'the pair row is routed to the record without either parent''s subject id');

-- 3. A permission that ends mid-job fails the job through the receipt.
savepoint mid_job_pause;
reset role;
select public.pause_family_sharing_v1(pg_temp.v('b','account'),pg_temp.v('a','account'));
set local role service_role;
select throws_ok($$select pg_temp.classes('subject','context')$$,'42501','not_found','a pause after the request fails the job at its next read');
rollback to mid_job_pause;
savepoint mid_job_revoke;
reset role;
-- Planted: the other parent's grant ends while the stored result stays.
update public.purpose_grants set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where grant_id=(select grant_id from portrait_grants where owner='b');
set local role service_role;
select throws_ok($$select pg_temp.classes('subject','metadata','portrait_results')$$,'42501','not_found',
 'a counterpart grant that ends after the request fails the job at its next read');
rollback to mid_job_revoke;
select is((select count(*) from jsonb_array_elements(pg_temp.classes('subject','metadata','portrait_results')->'rows')),2::bigint,
 'without a change the job still reads both results');
select throws_ok($$select public.export_archive_account_classes_v1('metadata','7a560000-0000-4000-8000-0000000000ee',
 (select attempt from sx where label='subject'),(select capture->>'authorityReceipt' from sx where label='subject'),'portrait_results',null)$$,
 '42501','not_found','another export id cannot page the record''s results');
reset role;

-- 4. Each way the other parent's permission is not live omits the row.
savepoint revoked_by_door;
select public.revoke_directional_purpose_v1(pg_temp.v('b','account'),(select grant_id from portrait_grants where owner='b'));
select is((select count(*) from public.portrait_results where family_pair_id=pg_temp.pair()),0::bigint,'the real revocation deletes the pair''s results');
select is(pg_temp.exported_ids(),'{}'::uuid[],'and nothing is exported for them');
set local role service_role;
select lives_ok($$select pg_temp.request('subject','capture')$$,'the record still exports after the revocation');
reset role;
rollback to revoked_by_door;
savepoint revoked_planted;
update public.purpose_grants set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where grant_id=(select grant_id from portrait_grants where owner='b');
select is((select count(*) from public.portrait_results where family_pair_id=pg_temp.pair()),2::bigint,'planted: the results outlive the ended grant');
select is(pg_temp.exported_ids(),'{}'::uuid[],'a counterpart grant that is revoked omits every result');
select is((pg_temp.entry('portrait_results')->>'rows')::bigint,0::bigint,'and the record''s class counts none');
rollback to revoked_planted;
savepoint paused;
select public.pause_family_sharing_v1(pg_temp.v('a','account'),pg_temp.v('b','account'));
select is((select count(*) from public.portrait_results where family_pair_id=pg_temp.pair()),2::bigint,'a pause keeps the stored results');
select is(pg_temp.exported_ids(),'{}'::uuid[],'a pause omits every result');
rollback to paused;
savepoint unacknowledged;
update public.subjects set portrait_acknowledged_at=null where id=pg_temp.v('b','subject');
select is(pg_temp.exported_ids(),'{}'::uuid[],'planted: a missing acknowledgement omits every result');
rollback to unacknowledged;
savepoint pair_not_current;
update public.family_pairs set status='revoked' where id=pg_temp.pair();
select is(pg_temp.exported_ids(),'{}'::uuid[],'planted: a pair that is no longer current omits every result');
set local role service_role;
select lives_ok($$select pg_temp.request('subject','capture')$$,'a pair that is not current no longer refuses the record');
reset role;
rollback to pair_not_current;
savepoint no_login;
update public.subjects set independent_login_at=null where id=pg_temp.v('b','subject');
select is(pg_temp.exported_ids(),'{}'::uuid[],'planted: an other parent who never signed in themselves omits every result');
rollback to no_login;
select is(pg_temp.exported_ids(),array['7a560000-0000-4000-8000-000000000101','7a560000-0000-4000-8000-000000000102']::uuid[],
 'every omission above was undone with its savepoint');

-- 5. A result that cannot be projected refuses the whole request.
savepoint uuid_result;
update public.portrait_results set result=jsonb_build_object('other',pg_temp.v('b','subject')) where id='7a560000-0000-4000-8000-000000000101';
set local role service_role;
select throws_ok($$select pg_temp.request('subject','capture')$$,'0A000','export_class_projection_unavailable',
 'planted: a result holding an identifier refuses the request');
reset role;
rollback to uuid_result;
savepoint array_result;
update public.portrait_results set result='[1,2,3]' where id='7a560000-0000-4000-8000-000000000102';
set local role service_role;
select throws_ok($$select pg_temp.request('subject','capture')$$,'0A000','export_class_projection_unavailable',
 'planted: a result that is not an object refuses the request');
reset role;
rollback to array_result;
savepoint mismatched_parents;
-- Planted: a second record whose person is the other parent (held by C), and
-- a result that names it beside the requester under the live pair.
insert into public.subjects(id,owner_account_id,subject_account_id,subject_class,upload_class,display_label,lifecycle)
 values('7a560000-0000-4000-8000-0000000000e1',pg_temp.v('c','account'),pg_temp.v('b','account'),'other_adult','adult','Planted second record','active');
insert into public.portrait_results(id,owner_account_id,parent_a_subject_id,parent_b_subject_id,family_pair_id,kind,trait_key,result,coverage,
 method_version,source_binding_fingerprint,computation_revision) values('7a560000-0000-4000-8000-000000000105',pg_temp.v('b','account'),
 pg_temp.v('a','subject'),'7a560000-0000-4000-8000-0000000000e1',pg_temp.pair(),'carrier_pair','planted-mismatch','{"band":"planted"}',1,
 'synthetic-portrait-v1',repeat('5',64),1);
set local role service_role;
select throws_ok($$select pg_temp.request('subject','capture')$$,'0A000','export_class_projection_unavailable',
 'planted: a result whose parents are not the live pair''s refuses the request');
reset role;
rollback to mismatched_parents;

-- 6. What nothing projects yet still refuses with the stated reason. Since
-- 20261023110000 the turns are written in the canonical shape, which the
-- group conversation projection reads.
create function pg_temp.family_chat(id uuid,pair uuid,legacy boolean,retrieved uuid[]) returns void language sql as $$
 insert into public.chats(id,user_id,scope_kind,family_pair_id,lifecycle_revision,provider_classification,runtime_attestation_revision,
  model_recipient_revision,authorization_fingerprint,legacy_unverified,canonical_authority)
 values(id,pg_temp.v('a','account'),'family',pair,1,'local',1,1,repeat('d',64),legacy,
  case when pair is null then '{"scope":"family-group"}'::jsonb end);
 insert into public.chat_messages(chat_id,user_id,role,content,turn_id,turn_ordinal,paired_role,scope_revision,authorization_fingerprint,
  retrieved_subject_ids,provider_classification,runtime_attestation_revision,model_recipient_revision,legacy_unverified)
 values(id,pg_temp.v('a','account'),'user','[{"type":"text","text":"synthetic"}]',gen_random_uuid(),1,'user',1,repeat('d',64),retrieved,'local',1,1,legacy);
$$;
savepoint pair_conversation;
select pg_temp.family_chat('7a560000-0000-4000-8000-000000000301',pg_temp.pair(),false,'{}');
select ok(private.export_subject_joint_results_v1(pg_temp.v('a','subject')),'a pair conversation with a turn is the joint result left on the record');
set local role service_role;
select throws_ok($$select pg_temp.request('subject','capture')$$,'0A000','export_joint_results_pending',
 'a record with a family conversation is refused with the stated reason');
select throws_ok($$select pg_temp.classes('subject','context')$$,'0A000','export_joint_results_pending',
 'a family conversation that appears after the request fails the job with the same reason');
reset role;
rollback to pair_conversation;
savepoint group_conversation;
select pg_temp.family_chat('7a560000-0000-4000-8000-000000000302',null,false,array[pg_temp.v('a','subject')]);
set local role service_role;
select lives_ok($$select pg_temp.request('subject','capture')$$,
 'a group conversation whose turn read the record no longer refuses: its current turns are projected (20261023110000)');
reset role;
select is((select count(*) from sx,private.export_subject_family_turn_rows_v1(origin,subject) where label='subject'),1::bigint,
 'and its one current turn is the record''s');
set local role service_role;
reset role;
rollback to group_conversation;
savepoint unrelated_group;
select pg_temp.family_chat('7a560000-0000-4000-8000-000000000303',null,false,array[pg_temp.v('b','subject')]);
select ok(not private.export_subject_joint_results_v1(pg_temp.v('a','subject')),'a group conversation is not a joint result on the record');
rollback to unrelated_group;
savepoint legacy_conversation;
select pg_temp.family_chat('7a560000-0000-4000-8000-000000000304',pg_temp.pair(),true,'{}');
select ok(not private.export_subject_joint_results_v1(pg_temp.v('a','subject')),
 'a legacy unverified conversation is never exported and does not refuse (owner decision, 26 September)');
rollback to legacy_conversation;
savepoint other_account_conversation;
insert into public.chats(id,user_id,scope_kind,family_pair_id,lifecycle_revision,provider_classification,runtime_attestation_revision,
 model_recipient_revision,authorization_fingerprint,legacy_unverified)
 values('7a560000-0000-4000-8000-000000000305',pg_temp.v('b','account'),'family',pg_temp.pair(),1,'local',1,1,repeat('d',64),false);
insert into public.chat_messages(chat_id,user_id,role,content,turn_id,turn_ordinal,paired_role,scope_revision,authorization_fingerprint,
 retrieved_subject_ids,provider_classification,runtime_attestation_revision,model_recipient_revision,legacy_unverified)
 values('7a560000-0000-4000-8000-000000000305',pg_temp.v('b','account'),'user','{"text":"synthetic"}',gen_random_uuid(),1,'user',1,repeat('d',64),
  array[pg_temp.v('a','subject')],'local',1,1,false);
select ok(not private.export_subject_joint_results_v1(pg_temp.v('a','subject')),
 'the other parent''s own conversation is theirs: it neither refuses nor enters the record''s export');
rollback to other_account_conversation;

-- 7. The whole-account export is unchanged.
savepoint account_unchanged;
select public.revoke_directional_purpose_v1(pg_temp.v('a','account'),(select grant_id from portrait_grants where owner='a'));
select public.revoke_directional_purpose_v1(pg_temp.v('b','account'),(select grant_id from portrait_grants where owner='b'));
-- The planted results of the other pair remain; the requester owns one.
set local role service_role;
select throws_ok($$select pg_temp.request('account','capture')$$,'0A000','export_class_projection_unavailable',
 'the whole-account export still refuses a nonempty Portrait class');
reset role;
delete from public.portrait_results;
set local role service_role;
update sx set capture=pg_temp.request(label,'capture') where label='account';
reset role;
select is((select x->>'mode' from sx,jsonb_array_elements(private.export_account_owned_capture_v1(origin,'account',subject)->'classInventory')x
 where label='account' and x->>'kind'='portrait_results'),'unsupported','and still reports Portrait results as unsupported');
set local role service_role;
update sx set created=pg_temp.request(label,'create',jsonb_build_object('envelope',pg_temp.envelope(label,'create',repeat('b',64)),
 'exportCookieHash',repeat('8',64)),repeat('c',64)) where label='account';
select lives_ok($$select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from sx where label='account'$$,
 'a whole-account job begins once no other person''s grant is current');
select throws_ok($$select pg_temp.classes('account','metadata','portrait_results')$$,'22023','invalid_request',
 'the classes door never pages Portrait results for a whole-account job');
select is((select x->>'mode' from jsonb_array_elements(pg_temp.classes('account','context')->'classes')x where x->>'kind'='portrait_results'),
 'unsupported','the account job''s context keeps Portrait results unsupported');
reset role;
rollback to account_unchanged;
reset role;

-- 8. The joint-result census: every table the pair and cohort deletion paths
-- touch, every table that can reference a pair, and every family, pair or
-- cohort scoped table, each classified for the one-record export. A new such
-- table fails here until it is classified.
create temporary view joint_census_universe as
with recursive edges as (select k.conrelid child,k.confrelid parent from pg_catalog.pg_constraint k where k.contype='f'),
pair_closure(oid) as (select 'public.family_pairs'::regclass::oid union select e.child from edges e join pair_closure c on e.parent=c.oid),
tables as (select c.oid,n.nspname||'.'||c.relname as name from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','private') and c.relkind in('r','p') and not c.relispartition),
purges as (select distinct lower(m[1]) as name from pg_catalog.pg_proc p
 cross join lateral regexp_matches(p.prosrc,'delete\s+from\s+((?:public|private)\.[a-z_0-9]+)','gi') m
 where p.pronamespace in('public'::regnamespace,'private'::regnamespace)
  and (p.proname ~ '(pair|portrait|family|heritab|cohort)' or p.prosrc ~* 'delete\s+from\s+public\.(family_pairs|portrait_results)\M'))
select t.name from tables t
where t.oid in(select oid from pair_closure) or t.name in(select name from purges)
 or t.name ~ '\.[a-z_]*(family|heritab|pair|portrait|health_picture)'
 or exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
  and a.attname in('family_pair_id','pair_id','cohort_id'))
 or exists(select 1 from pg_catalog.pg_constraint k where k.conrelid=t.oid and k.contype='f'
  and k.confrelid in('public.embryo_cohorts'::regclass,'public.embryos'::regclass));
create temporary table joint_census(name text primary key,disposition text not null,reason text not null);
insert into joint_census values
 -- Exported only while every other contributor's permission is live.
 ('public.portrait_results','live-permission','A joint result: projected to the record''s fields only while the other parent''s Portrait permission holds (export_subject_portrait_rows_v1).'),
 -- Since 20261023110000: family group conversation turns leave while every
 -- grant each turn used is current; a canonical pair conversation refuses.
 ('public.chats','live-permission','The record''s family group conversations leave while every turn''s grants are current (export_subject_family_turn_rows_v1); a canonical one on the record''s pair still refuses (export_subject_joint_results_v1). Self conversations are the record''s own.'),
 ('public.chat_messages','live-permission','Their turns, up to the first whose grants have ended, with record ids and links removed from citations; self turns keep their live-grant prefix.'),
 -- Since 20261023110000 (option A): the account's own cohort records leave
 -- on the self record, redacted; an adult record carries none.
 ('public.embryo_cohorts','own-cohort','The account''s own cohort rows, with the owner only as "is requester", on the self record.'),
 ('public.embryo_basis_bindings','own-cohort','The basis of the account''s own cohorts, evidence only as "recorded" flags.'),
 ('public.embryo_participant_sets','own-cohort','Each role in the account''s cohorts, the other parent only as "not the requester".'),
 ('public.embryo_donor_attributions','own-cohort','Donor attributions of the account''s cohorts, the donor only as "is requester" and the signature only as "recorded".'),
 ('public.embryo_disposition_proposals','own-cohort','Proposals in the account''s cohorts, the proposer only as "is requester".'),
 -- Embryo results are left out, and the manifest says so.
 ('public.embryos','left-out','An embryo result: never in a parent''s export (owner decision, 23 October 2026); an embryo is never the record.'),
 ('public.embryo_qc','left-out','An embryo result, left out of a parent''s export.'),
 ('public.embryo_scores','left-out','An embryo result, left out of a parent''s export.'),
 ('public.embryo_variants','left-out','An embryo result, left out of a parent''s export.'),
 ('public.embryo_figures','left-out','An embryo result, left out of a parent''s export.'),
 ('private.embryo_canonical_sources','left-out','A cohort''s sanitized embryo source, left out of a parent''s export.'),
 ('private.embryo_split_ordinals','left-out','Cohort split machinery behind embryo results, left out.'),
 ('private.embryo_split_variants','left-out','Embryo split calls, left out of a parent''s export.'),
 -- Still refused.
 ('public.report_artifacts','refused','A cohort or record report artifact refuses in the one-record class inventory; no writer ships.'),
 -- Not a joint result.
 ('public.family_pairs','not-joint','The pair record, not a result: exported with both contributor subject identities withheld.'),
 ('public.directional_grants','not-joint','Grant records: the record''s own grants leave as its permissions, without the recipient; grants received are the account''s.'),
 ('public.family_sharing_pauses','not-joint','An account-level action, not a result; outside a one-record export.'),
 ('public.family_sharing_stops','not-joint','An account-level action, not a result; outside a one-record export.'),
 ('public.subject_relationships','not-joint','Relationship metadata, not a result.'),
 ('private.family_ancestry_grant_snapshots','not-joint','Grant endpoint machinery.'),
 ('private.family_portrait_grant_snapshots','not-joint','Grant endpoint machinery.'),
 ('private.family_report_grant_snapshots','not-joint','Grant endpoint machinery.'),
 ('private.health_picture_grant_snapshots','not-joint','Grant endpoint machinery; the health picture reads each person''s own saved reports live.'),
 ('public.copilot_context_history','not-joint','Copilot retrieval machinery.'),
 ('public.copilot_turn_dependencies','not-joint','Copilot dependency machinery.'),
 ('public.copilot_context_tokens','not-joint','A credential.'),
 ('public.copilot_generation_sessions','not-joint','A credential.'),
 ('public.model_contexts','not-joint','Model call machinery.'),
 ('public.cloud_model_calls','not-joint','Model call machinery.'),
 ('public.cloud_provider_attempts','not-joint','Provider delivery machinery.'),
 ('public.cloud_provider_payloads','not-joint','Provider payload machinery.'),
 ('private.own_analysis_runs','not-joint','The record''s own saved results, made from its own DNA only.'),
 ('public.ancestry_results','not-joint','The record''s own ancestry results.'),
 ('public.ancestry_regions','not-joint','The record''s own regional estimates; no writer ships.'),
 ('public.user_variants','not-joint','The record''s own variants.'),
 ('public.user_prs','not-joint','The record''s own score coverage.'),
 ('public.report_observed_calls','not-joint','The record''s own observations.'),
 ('public.genome_files','not-joint','The record''s own files.'),
 ('public.genome_storage_objects','not-joint','Storage machinery for the record''s own files.'),
 ('public.pending_source_rows','not-joint','Preparation machinery.'),
 ('public.subjects','not-joint','The record itself.'),
 ('public.subject_principals','not-joint','The record''s own principals.'),
 ('public.subject_account_bindings','not-joint','The record''s own bindings.'),
 ('public.subject_consents','not-joint','The record''s own consents.'),
 ('public.subject_demographics','not-joint','The record''s own demographics.'),
 ('public.subject_invitations','not-joint','Invitation records, not results.'),
 ('public.subject_control_refusal_authorities','not-joint','Refusal authority metadata, not a result.'),
 ('public.consent_signatures','not-joint','The account''s own signatures.'),
 ('public.consent_grants','not-joint','Legacy account consents; outside a one-record export.'),
 ('public.attestations','not-joint','The account''s own attestations.'),
 ('public.attestation_contradictions','not-joint','Contradiction metadata, not a result.'),
 ('public.suppressions','not-joint','Condition suppression metadata; no writer ships.'),
 ('public.purpose_grants','not-joint','The record''s own permissions.'),
 ('public.provider_recipient_grants','not-joint','Account-level provider grants; outside a one-record export.'),
 ('public.profiles','not-joint','The requester''s profile.'),
 ('public.llm_keys','not-joint','A credential.'),
 ('public.llm_settings','not-joint','A credential.'),
 ('public.account_operation_nonces','not-joint','A credential.'),
 ('public.account_security_states','not-joint','Security machinery.'),
 ('public.purpose_grant_nonces','not-joint','A credential.'),
 ('public.rights_nonces','not-joint','A credential.'),
 ('public.rights_sessions','not-joint','A credential.'),
 ('public.token_candidates','not-joint','A credential.'),
 ('public.token_hashes','not-joint','A credential.'),
 ('public.download_sessions','not-joint','A credential.'),
 ('public.download_ranges','not-joint','Download machinery.'),
 ('public.upload_sessions','not-joint','A credential.'),
 ('public.upload_chunks','not-joint','Upload machinery.'),
 ('public.upload_staging_objects','not-joint','Upload machinery.'),
 ('public.generated_exports','not-joint','Export machinery.'),
 ('public.analysis_jobs','not-joint','Job machinery.'),
 ('public.worker_jobs','not-joint','Job machinery.'),
 ('public.worker_job_batches','not-joint','Job machinery.'),
 ('public.mail_outbox','not-joint','Mail machinery.'),
 ('public.mail_deliveries','not-joint','Mail machinery.'),
 ('public.mail_provider_attempts','not-joint','Mail machinery.'),
 ('public.encrypted_contact_references','not-joint','A protected contact value.'),
 ('public.invitation_reminders','not-joint','Invitation machinery.'),
 ('public.embryo_cohort_drafts','not-joint','A cohort draft, not a result.'),
 ('public.embryo_ingest_sessions','not-joint','Ingest machinery.'),
 ('public.embryo_ingest_unwinds','not-joint','Ingest machinery.'),
 ('public.embryo_operation_nonces','not-joint','A credential.'),
 ('private.embryo_withdrawal_credentials','not-joint','A credential.'),
 ('private.account_owned_cohort_purges','not-joint','Purge machinery.'),
 ('private.claimed_embryo_ingest_receipts','not-joint','Claimed-source provenance of an embryo record, never an ordinary record''s.'),
 ('private.claimed_embryo_job_receipts','not-joint','Claimed-source provenance of an embryo record, never an ordinary record''s.'),
 ('private.claim_reviews','not-joint','Staff review workflow.'),
 ('public.future_person_claims','not-joint','A claim on an embryo record, never an ordinary record''s.'),
 ('public.future_person_claim_sessions','not-joint','A credential.'),
 ('public.future_person_claim_notices','not-joint','Notice machinery.'),
 ('public.future_person_identity','not-joint','A protected identity value.'),
 ('public.future_person_record_key_hashes','not-joint','A credential.'),
 ('public.future_person_record_key_print_rights','not-joint','A credential.'),
 ('public.future_person_record_key_recipients','not-joint','Record Key delivery machinery.');
select set_eq('select name from joint_census_universe','select name from joint_census',
 'every pair-derived, pair-referencing, family, pair or cohort scoped table is classified for the one-record export');
select is((select array_agg(name order by name) from joint_census where disposition='live-permission'),
 array['public.chat_messages','public.chats','public.portrait_results'],
 'Portrait results and, since 20261023110000, family group conversations are the joint results exported under live permission');
select ok((select bool_and(disposition in('live-permission','own-cohort','left-out','refused','not-joint') and length(reason)>=10) from joint_census),
 'each classification is closed and has a reason');
-- Planted: a new pair-scoped results table is caught until it is classified.
savepoint census_plant;
create table public.joint_census_probe(id uuid primary key,pair uuid references public.family_pairs(id));
create table private.joint_census_probe_family_results(id uuid primary key);
select is((select array_agg(name order by name) from (select name from joint_census_universe except select name from joint_census)x),
 array['private.joint_census_probe_family_results','public.joint_census_probe'],'a new pair-referencing or family results table is unclassified');
rollback to census_plant;

-- 9. Planted defects in copies of the projection are each caught.
create function pg_temp.pause_ab() returns void language sql as $$ select public.pause_family_sharing_v1(pg_temp.v('a','account'),pg_temp.v('b','account')); $$;
savepoint plant_no_permission;
create or replace function private.export_subject_portrait_rows_v1(p_origin jsonb,p_subject uuid)
returns table(projected_id uuid,projected_subject uuid,projected_row jsonb) language sql security definer set search_path='' as $f$
 select r.id,p_subject,jsonb_build_object('id',r.id,'family_pair_id',r.family_pair_id,'kind',r.kind,'trait_key',r.trait_key,'result',r.result,
  'coverage',r.coverage,'method_version',r.method_version,'computation_revision',r.computation_revision,'computed_at',r.computed_at)
 from public.portrait_results r where p_subject in(r.parent_a_subject_id,r.parent_b_subject_id) order by r.id $f$;
select pg_temp.pause_ab();
select isnt(pg_temp.exported_ids(),'{}'::uuid[],'caught: a projection without the live-permission check exports while paused');
rollback to plant_no_permission;
savepoint plant_whole_row;
create or replace function private.export_subject_portrait_rows_v1(p_origin jsonb,p_subject uuid)
returns table(projected_id uuid,projected_subject uuid,projected_row jsonb) language sql security definer set search_path='' as $f$
 select r.id,p_subject,to_jsonb(r) from public.portrait_results r
 where p_subject in(r.parent_a_subject_id,r.parent_b_subject_id) and r.family_pair_id=(select id from public.family_pairs fp
  where p_subject in(fp.subject_a_id,fp.subject_b_id) and fp.status='current' limit 1) order by r.id $f$;
select isnt(pg_temp.forbidden_keys(),'{}'::text[],'caught: a whole-row projection carries forbidden fields');
select isnt(pg_temp.counterparty_values(),'{}'::text[],'caught: and names the other parent and the source fingerprint');
rollback to plant_whole_row;
savepoint plant_account_scope;
create or replace function private.export_subject_portrait_rows_v1(p_origin jsonb,p_subject uuid)
returns table(projected_id uuid,projected_subject uuid,projected_row jsonb) language sql security definer set search_path='' as $f$
 select r.id,p_subject,jsonb_build_object('id',r.id,'kind',r.kind) from public.portrait_results r
 where r.owner_account_id=(p_origin->>'accountId')::uuid order by r.id $f$;
select ok('7a560000-0000-4000-8000-000000000103'::uuid=any(pg_temp.exported_ids()),
 'caught: selecting by the holding account exports another pair''s result');
rollback to plant_account_scope;
savepoint plant_no_conversation_refusal;
-- Since 20261023110000 the pair conversation predicate is part of
-- export_subject_joint_results_v1, and the turn projection repeats it.
create or replace function private.export_subject_joint_results_v1(p_subject uuid) returns boolean language sql stable
 security definer set search_path='' as $f$ select false $f$;
select pg_temp.family_chat('7a560000-0000-4000-8000-000000000306',pg_temp.pair(),false,'{}');
set local role service_role;
select throws_ok($$select pg_temp.request('subject','capture')$$,'0A000','export_class_projection_unavailable',
 'without the conversation predicate the turn projection still refuses a pair conversation, so it never leaves');
reset role;
rollback to plant_no_conversation_refusal;

-- 10. Since 20261023110000 a cohort role no longer refuses. The fixture's
-- live cohort binds its parents through account-level genetic_parent
-- principals, which are the account's, not the record's; the planted row
-- gives the requester's own record principal a role in that live cohort.
savepoint cohort_role;
\ir fixtures/embryo_ingest_completed.inc
reset role;
insert into public.embryo_participant_sets(cohort_id,set_kind,principal_id,set_revision,membership_revision)
 select c.id,'notice_recipients',pg_temp.v('a','principal'),1,1 from public.embryo_cohorts c
 where c.status<>'purged' and c.owner_account_id='7a000000-0000-0000-0000-000000000001' order by c.id limit 1;
select is((select count(*) from public.embryo_participant_sets where principal_id=pg_temp.v('a','principal')),1::bigint,
 'planted: the requester''s record holds a role in a live cohort');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$select pg_temp.request('subject','capture')$$,
 'a record with a live embryo cohort role is captured, no longer refused (owner decision, 23 October 2026)');
reset role;
update public.embryo_cohorts set status='purged' where id=(select cohort_id from public.embryo_participant_sets where principal_id=pg_temp.v('a','principal'));
set local role service_role;
select lives_ok($$select pg_temp.request('subject','capture')$$,
 'a purged cohort''s history no longer refuses the record either');
reset role;
rollback to cohort_role;

-- 11. Patch hygiene: the four patched bodies are exactly the reviewed
-- successors (since 20261023110000, its successors of three of them) and the
-- new helpers are owner-only.
reset role;
select is((select array_agg(md5(pg_get_functiondef(p.oid)) order by p.oid::regprocedure::text) from pg_proc p where p.oid in(
 'private.export_subject_joint_results_v1(uuid)'::regprocedure,'private.export_subject_class_inventory_v1(uuid,jsonb)'::regprocedure,
 'private.export_account_owned_capture_pre_requester_v1(jsonb,text,uuid)'::regprocedure,
 'public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)'::regprocedure)),
 (select array_agg(m order by s) from (values
  ('export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)','577efc1f1c985d799c9e0f7391ccd0a1'),
  ('private.export_account_owned_capture_pre_requester_v1(jsonb,text,uuid)','32b11ad705abb2fea5b67d90a3bd6b0b'),
  ('private.export_subject_class_inventory_v1(uuid,jsonb)','4c56e0db2f05075fc393b4d8e815b9bb'),
  ('private.export_subject_joint_results_v1(uuid)','ca2b57f4fd138c2d092f3838f7524049'))x(s,m)),
 'each patched function is exactly its reviewed successor');
select ok(not has_function_privilege(r,f,'execute'),r||' cannot execute '||f) from unnest(array['anon','authenticated','inherit_upload_only','service_role'])r,
 unnest(array['private.export_subject_family_turn_rows_v1(jsonb,uuid)','private.export_subject_portrait_rows_v1(jsonb,uuid)',
  'private.export_scoped_class_rows_v1(jsonb,uuid[],text)'])f;
select ok(has_function_privilege('service_role','public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)','execute')
 and not has_function_privilege('authenticated','public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)','execute'),
 'the classes door keeps its service-only grant');

select * from finish();
rollback;
