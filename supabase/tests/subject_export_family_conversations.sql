begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- api.subject-export (20261023110000_export_completeness.sql), owner decision
-- of 23 October 2026 ("Export completeness: family conversations, cohorts,
-- empty classes"): the record's family Copilot conversation turns leave as
-- written while every grant each turn used is still current. Citations lose
-- their structured identifiers; a turn whose grants have ended is left out,
-- with every later turn of its conversation; another account's or another
-- pair's turn never appears; a grant that ends mid-job fails the job.
--
-- Also here: the TEST complete account archive's Portrait rows carry the
-- record's minimal fields only (item 5), and the synchronous archive's
-- pinned refusal of a class no writer fills (Q3).
--
-- Accounts, sessions, grants, pair, pauses and acknowledgements come from
-- the real doors. No production writer exists for a family conversation
-- outside a local model, nor for Portrait results, so the chats, turns, turn
-- dependencies and results named "planted" are synthetic owner-only rows.
-- Everything rolls back.
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
\ir fixtures/account_archive_ordinary_scientific.inc

-- B shares with A; C is a third account.
do $$ declare n integer; begin
 for n in 1..2 loop
  insert into auth.users(id,email,email_confirmed_at) values(('7b560000-0000-4000-8000-00000000000'||n)::uuid,'family-turns-'||n||'@e2e.local',now());
  insert into auth.sessions(id,user_id,created_at,updated_at,aal) values(('7b560000-0000-4000-8000-00000000001'||n)::uuid,
   ('7b560000-0000-4000-8000-00000000000'||n)::uuid,now(),now(),'aal1');
  update public.profiles set date_of_birth='1990-01-01' where id=('7b560000-0000-4000-8000-00000000000'||n)::uuid;
 end loop;
end $$;
create temporary table ft(label text primary key,account uuid,session uuid,subject uuid,principal uuid);
insert into ft(label,account,session) values
 ('a','77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010'),
 ('b','7b560000-0000-4000-8000-000000000001','7b560000-0000-4000-8000-000000000011'),
 ('c','7b560000-0000-4000-8000-000000000002','7b560000-0000-4000-8000-000000000012');
update ft set subject=s.id from public.subjects s where s.subject_account_id=ft.account and s.subject_class='self';
update ft set principal=p.id from public.subject_principals p where p.subject_id=ft.subject and p.account_id=ft.account
 and p.principal_kind='account_subject' and p.status='active';
create function pg_temp.v(which text,col text) returns uuid language sql stable as $$
 select case col when 'account' then account when 'session' then session when 'subject' then subject else principal end from ft where label=which;
$$;
select ok((select count(*)=3 and bool_and(subject is not null and principal is not null) from ft),'three real accounts with their own records');
select public.mark_independent_login_v1(account,session) from ft;

-- The real Portrait grants in both directions give the turns real grants to depend on.
create function pg_temp.grant_portrait(owner text,recipient text,nonce text) returns uuid language sql as $$
 select public.grant_family_portrait_purpose_v1(pg_temp.v(owner,'account'),pg_temp.v(owner,'session'),pg_temp.v(owner,'subject'),
  pg_temp.v(recipient,'principal'),pg_temp.v(recipient,'account'),'family.portrait',1,
  (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),nonce,
  public.family_portrait_grant_presentation_v1(pg_temp.v(owner,'account'),pg_temp.v(owner,'session'),pg_temp.v(owner,'subject'),
   pg_temp.v(recipient,'account')));
$$;
create temporary table grants as select 'b'::text owner,pg_temp.grant_portrait('b','a','family-turns-portrait-b') grant_id;
insert into grants select 'a',pg_temp.grant_portrait('a','b','family-turns-portrait-a');
select public.acknowledge_portrait_v1(pg_temp.v('a','account'),pg_temp.v('a','subject'));
select public.acknowledge_portrait_v1(pg_temp.v('b','account'),pg_temp.v('b','subject'));
create function pg_temp.pair() returns uuid language sql stable as $$
 select id from public.family_pairs where subject_low_id=least(pg_temp.v('a','subject'),pg_temp.v('b','subject'))
  and subject_high_id=greatest(pg_temp.v('a','subject'),pg_temp.v('b','subject'));
$$;
create function pg_temp.grant_of(owner text) returns uuid language sql stable as $$ select grant_id from grants where grants.owner=$1; $$;
select ok((select bool_and(revoked_at is null) from public.purpose_grants where grant_id in(select grant_id from grants)),'both real grants are current');

-- Planted family group conversations. A turn is a user/assistant pair under
-- one turn id; its dependencies are exactly what its tools read.
create function pg_temp.group_chat(chat uuid,owner text,legacy boolean default false,pair uuid default null) returns void language sql as $$
 insert into public.chats(id,user_id,scope_kind,family_pair_id,lifecycle_revision,provider_classification,runtime_attestation_revision,
  model_recipient_revision,authorization_fingerprint,legacy_unverified,canonical_authority,created_at)
 values(chat,pg_temp.v(owner,'account'),'family',pair,1,'local',1,1,repeat('d',64),legacy,
  case when pair is null then '{"scope":"family-group","provider":{"providerClass":"local"}}'::jsonb end,'2026-10-20T10:00:00Z');
$$;
create function pg_temp.turn(chat uuid,owner text,ordinal bigint,question text,answer text,citations jsonb,deps jsonb,legacy boolean default false)
returns uuid language plpgsql as $$
declare t uuid:=gen_random_uuid();d jsonb;
begin
 insert into public.chat_messages(chat_id,user_id,role,content,turn_id,turn_ordinal,paired_role,scope_revision,authorization_fingerprint,
  retrieved_subject_ids,provider_classification,runtime_attestation_revision,model_recipient_revision,legacy_unverified,canonical_citations,citation_ids,created_at)
 select chat,pg_temp.v(owner,'account'),r,jsonb_build_array(jsonb_build_object('type','text','text',case r when 'user' then question else answer end)),
  t,ordinal,r,1,repeat('d',64),'{}',
  'local',1,1,legacy,case r when 'assistant' then citations else '[]'::jsonb end,
  case r when 'assistant' then array(select x->>'id' from jsonb_array_elements(citations) x) else '{}'::text[] end,
  '2026-10-20T10:00:00Z'::timestamptz+make_interval(mins=>ordinal::integer)
 from unnest(array['user','assistant']) r;
 for d in select * from jsonb_array_elements(deps) loop
  insert into public.copilot_turn_dependencies(chat_id,turn_id,dependency_kind,dependency_id,dependency_revision,source_binding_fingerprint)
  values(chat,t,d->>'kind',(d->>'id')::uuid,(d->>'revision')::bigint,repeat('e',64));
 end loop;
 return t;
end $$;
create function pg_temp.grant_dep(owner text) returns jsonb language sql stable as $$
 select jsonb_build_object('kind','grant','id',g.grant_id,'revision',g.grant_revision) from public.purpose_grants g where g.grant_id=pg_temp.grant_of(owner);
$$;
create function pg_temp.subject_dep(who text) returns jsonb language sql stable as $$
 select jsonb_build_object('kind','subject','id',s.id,'revision',s.lifecycle_revision) from public.subjects s where s.id=pg_temp.v(who,'subject');
$$;
-- G1: three turns. The first read B's record, the second B's grant, the
-- third nothing. G2: one turn that read nothing.
select pg_temp.group_chat('7b560000-0000-4000-8000-0000000000c1','a');
select pg_temp.turn('7b560000-0000-4000-8000-0000000000c1','a',1,'Which of us carries the synthetic variant?','Synthetic answer one.',
 jsonb_build_array(jsonb_build_object('id','person:s-'||pg_temp.v('b','subject'),'label','Shared by Synthetic B','href','/family/s-'||pg_temp.v('b','subject')),
  jsonb_build_object('id','report:synthetic-carrier:'||repeat('a',64)||':s-'||pg_temp.v('b','subject'),'label','Synthetic carrier report',
   'href','/genome/s-'||pg_temp.v('b','subject')||'/reports/synthetic-carrier'),
  jsonb_build_object('id','pmid:12345678','label','Synthetic study','href','https://pubmed.ncbi.nlm.nih.gov/12345678/')),
 jsonb_build_array(pg_temp.subject_dep('b')));
select pg_temp.turn('7b560000-0000-4000-8000-0000000000c1','a',2,'And what does that mean for us?','Synthetic answer two.',
 jsonb_build_array(jsonb_build_object('id','doi:10.1000/synthetic','label','Synthetic review','href','https://doi.org/10.1000/synthetic')),
 jsonb_build_array(pg_temp.grant_dep('b')));
select pg_temp.turn('7b560000-0000-4000-8000-0000000000c1','a',3,'Thank you.','Synthetic answer three.','[]',jsonb_build_array());
select pg_temp.group_chat('7b560000-0000-4000-8000-0000000000c2','a');
select pg_temp.turn('7b560000-0000-4000-8000-0000000000c2','a',1,'What can you see?','Synthetic answer four.','[]',jsonb_build_array());

create temporary table sx(label text primary key,origin jsonb,target_kind text,subject uuid,capture jsonb,created jsonb,attempt uuid);
insert into sx(label,origin,target_kind,subject,attempt) values
 ('subject',jsonb_build_object('kind','account','accountId',pg_temp.v('a','account'),'sessionId',pg_temp.v('a','session')),'subject',pg_temp.v('a','subject'),
  '7b560000-0000-4000-8000-000000000201'),
 ('account',jsonb_build_object('kind','account','accountId',pg_temp.v('a','account'),'sessionId',pg_temp.v('a','session')),'account',pg_temp.v('a','account'),
  '7b560000-0000-4000-8000-000000000202');
grant select,update on sx to service_role;grant select on ft,grants,normalization_subject,export_snapshot to service_role;
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
create function pg_temp.turns_page(which text,after jsonb default 'null') returns jsonb language sql as $$
 select public.export_archive_account_content_v1('family-turns',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',
  jsonb_build_object('afterKey',after)) from sx where label=which;
$$;
-- The rows the record's export would carry, read as the owner.
create function pg_temp.rows(p_subject uuid default null) returns setof jsonb language sql as $$
 select x.projected_row from sx,private.export_subject_family_turn_rows_v1(origin,coalesce(p_subject,subject))x where label='subject'
 order by (x.projected_key->>0)::uuid,(x.projected_key->>1)::bigint,(x.projected_key->>2)::integer;
$$;
create function pg_temp.texts() returns text[] language sql as $$ select coalesce(array_agg(r->>'content'),'{}') from pg_temp.rows() r; $$;
create function pg_temp.membership() returns jsonb language sql as $$
 select private.export_account_owned_capture_v1(origin,'subject',subject)->'familyConversations' from sx where label='subject';
$$;
-- Identifiers that must never leave, on the projection and each planted copy.
create function pg_temp.leaked() returns text[] language sql as $$
 select coalesce(array_agg(distinct v order by v),'{}') from pg_temp.rows() r,
  unnest(array[pg_temp.v('a','account')::text,pg_temp.v('a','subject')::text,pg_temp.v('b','account')::text,pg_temp.v('b','subject')::text,
   pg_temp.v('c','account')::text,pg_temp.v('c','subject')::text,pg_temp.grant_of('a')::text,pg_temp.grant_of('b')::text,repeat('e',64),repeat('d',64)]) v
  where r::text like '%'||v||'%';
$$;
create function pg_temp.forbidden_keys() returns text[] language sql as $$
 select coalesce(array_agg(distinct k order by k),'{}') from pg_temp.rows() r,jsonb_object_keys(r) k
 where k not in('chat_id','chat_created_at','id','role','content','citations','created_at');
$$;
create function pg_temp.citation_ids() returns text[] language sql as $$
 select coalesce(array_agg(coalesce(c->>'id','')||'|'||coalesce(c->>'href','') order by 1),'{}') from pg_temp.rows() r,jsonb_array_elements(r->'citations') c
 where (c->>'id')~*'[0-9a-f]{8}-[0-9a-f]{4}-' or (c->>'href')~*'[0-9a-f]{8}-[0-9a-f]{4}-';
$$;

-- 1. The record's current turns leave as written.
reset role;
select is(pg_temp.texts(),array['Which of us carries the synthetic variant?','Synthetic answer one.','And what does that mean for us?',
 'Synthetic answer two.','Thank you.','Synthetic answer three.','What can you see?','Synthetic answer four.'],
 'every current turn of both group conversations leaves, question then answer, in conversation order');
select is((select r->'citations' from pg_temp.rows() r where r->>'content'='Synthetic answer one.'),
 '[{"label":"Shared by Synthetic B"},{"label":"Synthetic carrier report"},{"id":"pmid:12345678","label":"Synthetic study","href":"https://pubmed.ncbi.nlm.nih.gov/12345678/"}]'::jsonb,
 'a citation naming a person''s record keeps only its label; a publication keeps its id and link');
select is((select r->'citations' from pg_temp.rows() r where r->>'content'='Synthetic answer two.'),
 '[{"id":"doi:10.1000/synthetic","label":"Synthetic review","href":"https://doi.org/10.1000/synthetic"}]'::jsonb,'a DOI citation is kept whole');
select is(pg_temp.citation_ids(),'{}'::text[],'no citation id or link that names a record leaves');
select is(pg_temp.forbidden_keys(),'{}'::text[],'a turn carries only its seven written fields: no ordinal, retrieval ids or grant revisions');
select is(pg_temp.leaked(),'{}'::text[],'no account, record or grant id and no fingerprint appears in any exported turn');
select is((select r from pg_temp.rows() r where r->>'content'='What can you see?'),
 (select jsonb_build_object('chat_id',m.chat_id,'chat_created_at',c.created_at,'id',m.id,'role','user','content','What can you see?',
  'citations','[]'::jsonb,'created_at',m.created_at) from public.chat_messages m join public.chats c on c.id=m.chat_id
  where m.chat_id='7b560000-0000-4000-8000-0000000000c2' and m.role='user'),'a projected turn is the stored turn, verbatim');
select is((pg_temp.membership()->>'rows')::bigint,8::bigint,'the capture binds all eight current rows');
create function pg_temp.recomputed_digest() returns text language plpgsql as $$
declare d bytea:=extensions.digest(convert_to('account-family-turns-v1','UTF8'),'sha256');t record;
begin
 for t in select x.projected_key k,x.projected_row r from sx,private.export_subject_family_turn_rows_v1(origin,subject)x where label='subject'
  order by (x.projected_key->>0)::uuid,(x.projected_key->>1)::bigint,(x.projected_key->>2)::integer loop
  d:=extensions.digest(d||convert_to(t.k::text||':'||t.r::text||E'\n','UTF8'),'sha256');
 end loop;
 return encode(d,'hex');
end $$;
select is(pg_temp.membership()->>'membershipSha256',pg_temp.recomputed_digest(),'and their exact ordered membership digest');

-- 2. The real job reads the same rows through the content door.
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update sx set capture=pg_temp.request(label,'capture') where label='subject';
select is((select capture->'subjectPartitions' from sx where label='subject'),jsonb_build_array(pg_temp.v('a','subject')),
 'a record with family conversations is captured, no longer refused');
update sx set created=pg_temp.request(label,'create',jsonb_build_object('envelope',pg_temp.envelope(label,'create',repeat('a',64)),
 'exportCookieHash',repeat('9',64)),repeat('c',64)) where label='subject';
select lives_ok('set constraints all immediate','the genuine request flushes every deferred creation invariant');
set constraints all deferred;
select lives_ok($$select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from sx where label='subject'$$,
 'the durable worker begins the record''s attempt');
reset role;
create temporary table expected_rows as select r::text row_text,n from pg_temp.rows() with ordinality x(r,n);
create temporary table expected_membership as select pg_temp.membership() m;
grant select on expected_rows,expected_membership to service_role;
set local role service_role;
select is((select jsonb_agg(r->>'rowText' order by n) from jsonb_array_elements(pg_temp.turns_page('subject')->'rows') with ordinality x(r,n)),
 (select jsonb_agg(row_text order by n) from expected_rows),'the door pages exactly the projected rows, in order');
select is(pg_temp.turns_page('subject')->'membership',(select m from expected_membership),'each page names the captured membership');
select ok(pg_temp.turns_page('subject')->'nextAfterKey'='null'::jsonb,'eight rows fit one page');
select is((select count(*) from jsonb_array_elements(pg_temp.turns_page('subject',
 jsonb_build_array('7b560000-0000-4000-8000-0000000000c1',3,1))->'rows')),2::bigint,'a page after a key holds only the later rows');
select throws_ok($$select pg_temp.turns_page('subject','["7b560000-0000-4000-8000-0000000000c1",3,2]'::jsonb)$$,'22023','invalid_request',
 'a key outside the closed shape is refused');
select throws_ok($$select public.export_archive_account_content_v1('family-turns',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',
 '{"afterKey":null,"subjectId":null}') from sx where label='subject'$$,'22023','invalid_request','an extra payload field is refused');

-- 3. A grant that ends mid-job fails the job through the receipt.
savepoint mid_job_revoke;
reset role;
update public.purpose_grants set revoked_at=clock_timestamp(),revocation_reason='withdrawn' where grant_id=pg_temp.grant_of('b');
set local role service_role;
select throws_ok($$select pg_temp.turns_page('subject')$$,'42501',null,'a grant that ends after the request fails the job at its next page');
rollback to mid_job_revoke;
savepoint mid_job_pause;
reset role;
select public.pause_family_sharing_v1(pg_temp.v('b','account'),pg_temp.v('a','account'));
set local role service_role;
select throws_ok($$select pg_temp.turns_page('subject')$$,'42501',null,'a pause after the request fails the job at its next page');
rollback to mid_job_pause;
-- A conversation that grows after the request fails the job too.
savepoint mid_job_turn;
reset role;
select pg_temp.turn('7b560000-0000-4000-8000-0000000000c2','a',2,'And now?','Synthetic answer five.','[]',jsonb_build_array());
set local role service_role;
select throws_ok($$select pg_temp.turns_page('subject')$$,'42501',null,'planted: a turn written after the request fails the job at its next page');
rollback to mid_job_turn;
select is((select count(*) from jsonb_array_elements(pg_temp.turns_page('subject')->'rows')),8::bigint,'without a change the job still pages every row');
reset role;

-- 4. A turn whose grants have ended is left out, with every later turn.
savepoint ended_grant;
update public.purpose_grants set revoked_at=clock_timestamp(),revocation_reason='withdrawn' where grant_id=pg_temp.grant_of('b');
select is(pg_temp.texts(),array['Which of us carries the synthetic variant?','Synthetic answer one.','What can you see?','Synthetic answer four.'],
 'planted: after B''s grant ends, the turn that used it and the turn after it are left out; the earlier turn and the other conversation stay');
select is((pg_temp.membership()->>'rows')::bigint,4::bigint,'and the capture counts only what is left');
rollback to ended_grant;
savepoint real_revoke;
select public.revoke_directional_purpose_v1(pg_temp.v('b','account'),pg_temp.grant_of('b'));
select is(pg_temp.texts(),array['Which of us carries the synthetic variant?','Synthetic answer one.','What can you see?','Synthetic answer four.'],
 'the real revocation leaves the same turns');
rollback to real_revoke;
savepoint paused;
select public.pause_family_sharing_v1(pg_temp.v('a','account'),pg_temp.v('b','account'));
select is(pg_temp.texts(),array['What can you see?','Synthetic answer four.'],
 'while a pause holds, the conversation that read B''s record leaves nothing; the other conversation stays');
rollback to paused;
savepoint ended_record;
update public.subjects set lifecycle_revision=lifecycle_revision+1 where id=pg_temp.v('b','subject');
select is(pg_temp.texts(),array['What can you see?','Synthetic answer four.'],'planted: a changed record of B ends the turns that read it');
rollback to ended_record;
select is(cardinality(pg_temp.texts()),8,'every omission above was undone with its savepoint');

-- 5. Another account's, another pair's and a legacy turn never appear.
savepoint foreign_turns;
select pg_temp.group_chat('7b560000-0000-4000-8000-0000000000c3','b');
select pg_temp.turn('7b560000-0000-4000-8000-0000000000c3','b',1,'B asks','B answer','[]',jsonb_build_array());
insert into public.family_pairs(id,subject_a_id,subject_b_id,status) values('7b560000-0000-4000-8000-0000000000f1',pg_temp.v('b','subject'),pg_temp.v('c','subject'),'current');
select pg_temp.group_chat('7b560000-0000-4000-8000-0000000000c4','a',false,'7b560000-0000-4000-8000-0000000000f1');
select pg_temp.turn('7b560000-0000-4000-8000-0000000000c4','a',1,'Another pair asks','Another pair answer','[]',jsonb_build_array());
select pg_temp.group_chat('7b560000-0000-4000-8000-0000000000c5','a',true,pg_temp.pair());
select pg_temp.turn('7b560000-0000-4000-8000-0000000000c5','a',1,'Legacy asks','Legacy answer','[]',jsonb_build_array(),true);
select is(cardinality(pg_temp.texts()),8,'B''s own conversation, A''s conversation on another pair and a legacy conversation on the record''s pair add nothing');
select ok(not private.export_subject_joint_results_v1(pg_temp.v('a','subject')),'none of them is a joint result on the record');
set local role service_role;
select lives_ok($$select pg_temp.request('subject','capture')$$,'and none of them refuses the record');
reset role;
rollback to foreign_turns;

-- 6. What still refuses: a canonical conversation anchored on a pair naming
-- the record, which no writer makes (the jointResults reason, still in the
-- route's closed list), and a citation label that holds an identifier.
savepoint pair_conversation;
select pg_temp.group_chat('7b560000-0000-4000-8000-0000000000c6','a',false,pg_temp.pair());
select pg_temp.turn('7b560000-0000-4000-8000-0000000000c6','a',1,'Pair asks','Pair answer','[]',jsonb_build_array());
select ok(private.export_subject_joint_results_v1(pg_temp.v('a','subject')),'a canonical conversation on the record''s pair is the joint result left');
set local role service_role;
select throws_ok($$select pg_temp.request('subject','capture')$$,'0A000','export_joint_results_pending',
 'and it still refuses the record with the stated reason');
reset role;
select throws_ok($$select * from pg_temp.rows()$$,'0A000','export_class_projection_unavailable',
 'the projection refuses it too, so its turns can never be read');
rollback to pair_conversation;
savepoint group_no_joint;
select ok(not private.export_subject_joint_results_v1(pg_temp.v('a','subject')),
 'a group conversation, whatever it read, is no longer a joint result');
rollback to group_no_joint;
savepoint uuid_label;
update public.chat_messages set canonical_citations=jsonb_build_array(jsonb_build_object('id','pmid:12345678',
 'label','Shared by '||pg_temp.v('b','subject'),'href','https://pubmed.ncbi.nlm.nih.gov/12345678/'))
 where chat_id='7b560000-0000-4000-8000-0000000000c2' and role='assistant';
set local role service_role;
select throws_ok($$select pg_temp.request('subject','capture')$$,'0A000','export_class_projection_unavailable',
 'planted: a citation label holding an identifier refuses the request');
reset role;
rollback to uuid_label;
savepoint bad_content;
update public.chat_messages set content='[{"type":"text","text":"a"},{"type":"text","text":"b"}]' where chat_id='7b560000-0000-4000-8000-0000000000c2' and role='user';
select throws_ok($$select * from pg_temp.rows()$$,'0A000','export_class_projection_unavailable','planted: a turn of another shape refuses');
rollback to bad_content;

-- 7. An adult record carries no conversation; another account's origin reads none.
savepoint adult_record;
insert into public.subjects(id,owner_account_id,subject_account_id,subject_class,upload_class,display_label,lifecycle)
 values('7b560000-0000-4000-8000-0000000000e1',pg_temp.v('c','account'),pg_temp.v('a','account'),'other_adult','adult','Planted adult record','active');
select is((select count(*) from pg_temp.rows('7b560000-0000-4000-8000-0000000000e1')),0::bigint,'the account''s adult record carries no group conversation');
select is((private.export_subject_family_turn_capture_v1((select origin from sx where label='subject'),'7b560000-0000-4000-8000-0000000000e1')
 ->>'rows')::bigint,0::bigint,'and the receipt binds none for it');
rollback to adult_record;
select throws_ok($$select * from private.export_subject_family_turn_rows_v1(jsonb_build_object('kind','account','accountId',pg_temp.v('b','account'),
 'sessionId',pg_temp.v('b','session')),pg_temp.v('a','subject'))$$,'42501','not_found','another account cannot read the record''s turns');

-- 8. Planted defects in copies of the projection are each caught.
savepoint plant_no_currentness;
create or replace function private.family_copilot_turn_state_v1(p_account uuid,p_chat uuid,p_turn uuid) returns text language sql stable
 security definer set search_path=pg_catalog as $f$ select 'current'::text $f$;
update public.purpose_grants set revoked_at=clock_timestamp(),revocation_reason='withdrawn' where grant_id=pg_temp.grant_of('b');
select is(cardinality(pg_temp.texts()),8,'caught: without the currentness check a turn whose grant ended would leave');
rollback to plant_no_currentness;
savepoint plant_whole_citations;
create or replace function private.export_subject_family_turn_rows_v1(p_origin jsonb,p_subject uuid)
returns table(projected_key jsonb,projected_row jsonb) language sql security definer set search_path='' as $f$
 select jsonb_build_array(m.chat_id,m.turn_ordinal,case m.role when 'user' then 0 else 1 end),
  jsonb_build_object('chat_id',m.chat_id,'chat_created_at',c.created_at,'id',m.id,'role',m.role,'content',m.content->0->>'text',
   'citations',m.canonical_citations,'created_at',m.created_at,'turn_ordinal',m.turn_ordinal)
 from public.chats c join public.chat_messages m on m.chat_id=c.id where c.user_id=(p_origin->>'accountId')::uuid and c.scope_kind='family' $f$;
select isnt(pg_temp.citation_ids(),'{}'::text[],'caught: whole citations name the other person''s record');
select isnt(pg_temp.forbidden_keys(),'{}'::text[],'caught: and a whole row carries the ordinal');
rollback to plant_whole_citations;
savepoint plant_account_scope;
create or replace function private.export_subject_family_turn_rows_v1(p_origin jsonb,p_subject uuid)
returns table(projected_key jsonb,projected_row jsonb) language sql security definer set search_path='' as $f$
 select jsonb_build_array(m.chat_id,m.turn_ordinal,case m.role when 'user' then 0 else 1 end),
  jsonb_build_object('chat_id',m.chat_id,'id',m.id,'role',m.role,'content',m.content->0->>'text')
 from public.chats c join public.chat_messages m on m.chat_id=c.id where c.scope_kind='family' $f$;
select pg_temp.group_chat('7b560000-0000-4000-8000-0000000000c3','b');
select pg_temp.turn('7b560000-0000-4000-8000-0000000000c3','b',1,'B asks','B answer','[]',jsonb_build_array());
select ok('B answer'=any(pg_temp.texts()),'caught: selecting family chats without the account exports another account''s turn');
rollback to plant_account_scope;

-- 9. The TEST complete archive's Portrait rows carry the record's own fields
-- only (item 5). Source readiness is stubbed so the projection can be reached
-- with these synthetic results; the permission checks around it are real.
savepoint complete_portrait;
insert into public.portrait_results(id,owner_account_id,parent_a_subject_id,parent_b_subject_id,family_pair_id,kind,trait_key,result,coverage,
 method_version,source_binding_fingerprint,computation_revision) values
 ('7b560000-0000-4000-8000-000000000101',pg_temp.v('b','account'),pg_temp.v('a','subject'),pg_temp.v('b','subject'),pg_temp.pair(),
  'carrier_pair','synthetic-carrier','{"band":"one-in-four"}',0.75,'synthetic-portrait-v1',repeat('9',64),1);
create or replace function public.family_portrait_source_readiness_v1(p_account_id uuid,p_session_id uuid,p_pair_id uuid,
 p_counterpart_account_id uuid,p_expected text default null)
returns jsonb language sql stable security definer set search_path='' as $f$ select '{"planted":"ready"}'::jsonb $f$;
create temporary table complete_rows as select x.* from private.account_archive_complete_class_rows_v1(
 (select origin from sx where label='account'),'{"partitions":[]}',
 jsonb_build_array(jsonb_build_object('subjectId',pg_temp.v('a','subject'),'status','permitted','class','consent-covered'),
  jsonb_build_object('subjectId',pg_temp.v('b','subject'),'status','permitted','class','consent-covered')),'portrait_results')x;
select is((select count(*) from complete_rows),1::bigint,'the live result reaches the complete archive''s projection');
select is((select array_agg(k order by k) from complete_rows,jsonb_object_keys(row_text::jsonb) k),
 array['computation_revision','computed_at','coverage','family_pair_id','id','kind','method_version','result','trait_key'],
 'it carries the same nine fields as the one-record export');
select ok((select row_text not like '%'||pg_temp.v('b','account')::text||'%' and row_text not like '%'||pg_temp.v('a','subject')::text||'%'
 and row_text not like '%'||pg_temp.v('b','subject')::text||'%' and row_text not like '%'||repeat('9',64)||'%' from complete_rows),
 'never the holding account, either parent''s record or the source fingerprint');
update public.portrait_results set result=jsonb_build_object('other',pg_temp.v('b','subject')) where id='7b560000-0000-4000-8000-000000000101';
select throws_ok($$select * from private.account_archive_complete_class_rows_v1((select origin from sx where label='account'),'{"partitions":[]}',
 jsonb_build_array(jsonb_build_object('subjectId',pg_temp.v('a','subject'),'status','permitted','class','consent-covered'),
  jsonb_build_object('subjectId',pg_temp.v('b','subject'),'status','permitted','class','consent-covered')),'portrait_results')$$,
 '0A000','export_class_projection_unavailable','planted: a result holding an identifier refuses');
rollback to complete_portrait;

-- 10. The synchronous archive's pinned refusal of the five classes no writer fills (Q3).
create function pg_temp.writerless(which text) returns bigint language sql as $$
 select (public.own_export_writerless_rows_v1(pg_temp.v(which,'account'),pg_temp.v(which,'session'))->>'rows')::bigint;
$$;
select is(pg_temp.writerless('a'),0::bigint,'with no row of any of them, the synchronous archive may run');
-- Planted reference rows: the shared catalogue ships no region release.
insert into public.ref_region_releases(release_id,name,source_sha256,published_at) values('ancestry-regions-v9001','Synthetic release',repeat('f',64),now());
insert into public.ref_regions(release_id,region_code,display_name,level,sort_order) values('ancestry-regions-v9001','synthetic-region','Synthetic region',0,0);
create temporary table writerless_plants(kind text,statement text);
insert into writerless_plants values
 ('ancestry_regions',$p$insert into public.ancestry_results(user_id,file_id,kind,result,support_note,subject_id) values(pg_temp.v('a','account'),
  '77900000-0000-4000-8000-000000000040','admixture','{}','synthetic',pg_temp.v('a','subject'));
  insert into public.ancestry_regions(ancestry_result_id,subject_id,release_id,region_code,point,p05,p95,markers_used,method_version,evidence_label)
  select id,pg_temp.v('a','subject'),'ancestry-regions-v9001','synthetic-region',0.5,0.4,0.6,10,'synthetic','preliminary' from public.ancestry_results
  where subject_id=pg_temp.v('a','subject') order by created_at desc limit 1$p$),
 ('attestation_contradictions',$p$insert into public.attestation_contradictions(subject_id,principal_id,contradiction_code,lifecycle_revision)
  values(pg_temp.v('a','subject'),pg_temp.v('a','principal'),'synthetic',1)$p$),
 ('subject_control_refusal_authorities',$p$insert into public.subject_control_refusal_authorities(subject_id,principal_id,authority_revision,status)
  values(pg_temp.v('a','subject'),pg_temp.v('a','principal'),1,'current')$p$),
 ('suppressions',$p$insert into public.suppressions(subject_id,condition_id,reason_code,suppression_revision)
  values(pg_temp.v('a','subject'),'synthetic-condition','synthetic',1)$p$),
 ('report_artifacts',$p$insert into public.report_artifacts(subject_id,report_kind,report_revision,source_binding_fingerprint,artifact)
  values(pg_temp.v('a','subject'),'synthetic',1,repeat('a',64),'{}')$p$);
create function pg_temp.plant(kind text) returns bigint language plpgsql as $$
declare n bigint;
begin
 execute (select statement from writerless_plants p where p.kind=$1);
 n:=pg_temp.writerless('a');
 raise exception using errcode='P0001',message='planted:'||n;
exception when sqlstate 'P0001' then return split_part(sqlerrm,':',2)::bigint;
end $$;
select is(pg_temp.plant(kind),1::bigint,'planted: one '||kind||' row of the requester refuses the synchronous archive') from writerless_plants order by kind;
savepoint foreign_writerless;
insert into public.suppressions(subject_id,condition_id,reason_code,suppression_revision) values(pg_temp.v('c','subject'),'synthetic-condition','synthetic',1);
select is(pg_temp.writerless('a'),0::bigint,'another account''s row does not refuse the requester''s archive');
select is(pg_temp.writerless('c'),1::bigint,'it refuses that account''s own');
rollback to foreign_writerless;
select throws_ok($$select public.own_export_writerless_rows_v1(pg_temp.v('a','account'),pg_temp.v('b','session'))$$,'42501',null,
 'the count answers only under the requester''s own session');
select throws_ok($$select public.own_export_writerless_rows_v1(null,pg_temp.v('a','session'))$$,'22023','invalid_request','an incomplete request is refused');

-- 11. Hygiene: the new functions' privileges and the dropped predicate.
select ok(not has_function_privilege(r,f,'execute'),r||' cannot execute '||f) from unnest(array['anon','authenticated','inherit_upload_only','service_role'])r,
 unnest(array['private.export_subject_family_turn_rows_v1(jsonb,uuid)','private.export_subject_family_turn_capture_v1(jsonb,uuid)'])f;
select ok(has_function_privilege('service_role','public.own_export_writerless_rows_v1(uuid,uuid)','execute'),'the service role reads the writer-less count');
select ok(not has_function_privilege(r,'public.own_export_writerless_rows_v1(uuid,uuid)','execute'),r||' cannot read the writer-less count')
 from unnest(array['anon','authenticated','inherit_upload_only'])r;
select ok(to_regprocedure('private.export_subject_family_conversation_v1(uuid)') is null,'the conversation predicate the projection replaced is gone');

select * from finish();
rollback;
