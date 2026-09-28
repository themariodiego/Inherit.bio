begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- L-34 and the owner's decision of 28 Sep 2026: who acted is recorded on new
-- legal audit events, and the export carries the events a person caused
-- themselves. Synthetic accounts only; everything rolls back, including the
-- planted definitions at the end.
--
-- A pgTAP file is one transaction, and the actor context is transaction-local.
-- pg_temp.next_transaction() clears it where production would have committed.

insert into auth.users(id,email) values
 ('7a000000-0000-4000-8000-000000000001','legal-audit-owner@e2e.local'),
 ('7a000000-0000-4000-8000-000000000002','legal-audit-other@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('7a000000-0000-4000-8000-000000000010','7a000000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('7a000000-0000-4000-8000-000000000011','7a000000-0000-4000-8000-000000000002',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01'
 where id in ('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000002');

create function pg_temp.next_transaction() returns void language plpgsql as $$
begin
 perform set_config('inherit.legal_audit_actor','',true);
 perform set_config('request.jwt.claims','',true);
end $$;
create function pg_temp.append(code text,route text) returns uuid language sql as $$
 select (private.append_legal_audit_event(code,null,route,'accepted','{"fixture":true}'::jsonb)).audit_principal_id
$$;
create function pg_temp.pseudonym(who uuid) returns uuid language sql as $$
 select audit_principal_id from private.legal_audit_account_principals where account_id=who
$$;
-- Consuming a real embryo operation nonce, through the real consumer.
create function pg_temp.consume(who uuid,nonce text) returns void language sql as $$
 select private.consume_embryo_operation_nonce_v1(nonce,who,
  case who when '7a000000-0000-4000-8000-000000000001' then '7a000000-0000-4000-8000-000000000010'::uuid
   else '7a000000-0000-4000-8000-000000000011'::uuid end,'fixture_operation','account',who)
$$;
create function pg_temp.slice(who uuid,sess uuid,after_seq bigint default null) returns jsonb language sql as $$
 select public.own_legal_audit_events_v1(who,sess,after_seq)
$$;
create temporary table appended(label text primary key,principal uuid);
select pg_temp.next_transaction();

-- Shape and privileges.
select has_table('private','legal_audit_account_principals','the account-to-pseudonym link exists');
select is((select confdeltype::text from pg_constraint where conrelid='private.legal_audit_account_principals'::regclass
 and confrelid='auth.users'::regclass and contype='f'),'c','the link is deleted with the account');
select is((select count(*) from public.purge_target_stores where target_id='audit-principal-link-key-envelope'
 and store_name='private.legal_audit_account_principals'),1::bigint,'the link is a registered purge store of the audit-link target');
select is((select count(*) from private.legal_audit_attribution_config),1::bigint,'one attribution start is recorded');
select ok(not has_function_privilege('anon','public.own_legal_audit_events_v1(uuid,uuid,bigint)','execute'),
 'anon cannot read a legal audit slice');
select ok(not has_function_privilege('authenticated','public.own_legal_audit_events_v1(uuid,uuid,bigint)','execute'),
 'authenticated cannot read a legal audit slice');
select ok(has_function_privilege('service_role','public.own_legal_audit_events_v1(uuid,uuid,bigint)','execute'),
 'the server can');
select ok(not has_table_privilege('service_role','private.legal_audit_account_principals','select'),
 'the server cannot read the link directly');
select ok((select bool_and(relrowsecurity) from pg_class where oid in
 ('private.legal_audit_account_principals'::regclass,'private.legal_audit_attribution_config'::regclass)),
 'both new tables deny rows by default');
select ok(has_function_privilege('service_role','private.append_legal_audit_event(text,uuid,text,text,jsonb)','execute')
 and not has_function_privilege('authenticated','private.append_legal_audit_event(text,uuid,text,text,jsonb)','execute')
 and not has_function_privilege('anon','private.append_legal_audit_event(text,uuid,text,text,jsonb)','execute'),
 'the redefined writer keeps exactly the grants it had');

-- No proof in the transaction: nothing is recorded.
select is(pg_temp.append('purpose.granted','api.consents'),null::uuid,'with no proof of who acted, a person''s event names no one');
select is(pg_temp.pseudonym('7a000000-0000-4000-8000-000000000001'),null::uuid,'and no pseudonym is created');

-- A consumed nonce names the account the operation was performed for.
select pg_temp.consume('7a000000-0000-4000-8000-000000000001','legal-audit-owner-nonce-01');
insert into appended values('owner-1',pg_temp.append('purpose.granted','api.consents'));
select isnt((select principal from appended where label='owner-1'),null::uuid,'after a consumed nonce, the event names who acted');
select is((select principal from appended where label='owner-1'),pg_temp.pseudonym('7a000000-0000-4000-8000-000000000001'),
 'as that account''s own pseudonym');
select isnt((select principal from appended where label='owner-1'),'7a000000-0000-4000-8000-000000000001'::uuid,
 'which is not the account id');
insert into appended values('owner-2',pg_temp.append('jurisdiction.declared','api.jurisdiction'));
select is((select principal from appended where label='owner-2'),(select principal from appended where label='owner-1'),
 'one pseudonym per account');
select is((select count(*) from private.legal_audit_account_principals where account_id='7a000000-0000-4000-8000-000000000001'),
 1::bigint,'and one link');

-- The service's own acts name no one, even in a person's transaction.
select is(pg_temp.append('purpose.purge-complete','api.jobs.retention'),null::uuid,'a purge names no one');
select is(pg_temp.append('purpose.purge-enqueued','api.consent-revoke'),null::uuid,'a queued purge names no one');
select is(pg_temp.append('embryo.response.blocked','api.embryos'),null::uuid,'a blocked response names no one');
select is(pg_temp.append('embryo.draft.expired','jobs.retention'),null::uuid,'an expiry names no one');
select is(pg_temp.append('purpose.granted','jobs.retention'),null::uuid,'nothing on a job route names anyone');
select is(pg_temp.append('purpose.granted',null),null::uuid,'nor an event with no route');
select is(pg_temp.append('fixture.new-event','api.consents'),null::uuid,'an event not on the list names no one until it is added');

-- Two accounts in one transaction is a conflict, and a conflict names no one.
select pg_temp.consume('7a000000-0000-4000-8000-000000000002','legal-audit-other-nonce-01');
select is(pg_temp.append('purpose.granted','api.consents'),null::uuid,'two accounts in one transaction name no one');
select pg_temp.next_transaction();

-- Each nonce table is proof.
insert into public.purpose_grant_nonces(nonce_hash,account_id) values(repeat('e',64),'7a000000-0000-4000-8000-000000000002');
insert into appended values('other-1',pg_temp.append('purpose.granted','api.consents'));
select is((select principal from appended where label='other-1'),pg_temp.pseudonym('7a000000-0000-4000-8000-000000000002'),
 'a consumed purpose-grant nonce names its account');
select isnt((select principal from appended where label='other-1'),(select principal from appended where label='owner-1'),
 'which has its own pseudonym');
select pg_temp.next_transaction();
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at) values
 (repeat('f',64),'7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000010','account_delete',
  clock_timestamp()+interval '9 minutes');
select is(pg_temp.append('purpose.granted','api.consents'),null::uuid,'issuing an account nonce is not proof');
update public.account_operation_nonces set consumed_at=clock_timestamp() where nonce_hash=repeat('f',64);
insert into appended values('owner-3',pg_temp.append('family.sharing_paused','api.family-sharing'));
select is((select principal from appended where label='owner-3'),pg_temp.pseudonym('7a000000-0000-4000-8000-000000000001'),
 'consuming it is');
select pg_temp.next_transaction();

-- A user's own JWT is proof; the service role's is not; a disagreement is not.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"7a000000-0000-4000-8000-000000000002"}',true);
insert into appended values('other-2',pg_temp.append('portrait.acknowledged','api.family-acknowledge'));
select is((select principal from appended where label='other-2'),pg_temp.pseudonym('7a000000-0000-4000-8000-000000000002'),
 'an authenticated request names its own subject');
select pg_temp.consume('7a000000-0000-4000-8000-000000000001','legal-audit-owner-nonce-02');
select is(pg_temp.append('purpose.granted','api.consents'),null::uuid,'a JWT and a nonce that disagree name no one');
select pg_temp.next_transaction();
select set_config('request.jwt.claims','{"role":"service_role","sub":"7a000000-0000-4000-8000-000000000002"}',true);
select is(pg_temp.append('purpose.granted','api.consents'),null::uuid,'the service role names no one');
select pg_temp.next_transaction();

-- A real writer: an own report purpose grant consumes its nonce and is attributed.
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
create temporary table owner_subject as select id from public.subjects
 where subject_account_id='7a000000-0000-4000-8000-000000000001' and subject_class='self';
select public.sign_own_upload_artifact_v1('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000010',
 (select id from owner_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000010',
 (select id from owner_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
select pg_temp.next_transaction();
create temporary table ledger_before as select max(seq) seq from public.legal_audit_log;
select public.grant_own_report_purpose_v1('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000010',
 (select id from owner_subject),public.own_report_context_v1('7a000000-0000-4000-8000-000000000001',
  '7a000000-0000-4000-8000-000000000010',(select id from owner_subject)),'ancestry',
 (select version from public.consent_artifacts where artifact_key='consent.own-ancestry' and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.own-ancestry' and superseded_at is null),
 repeat('9',64),clock_timestamp()+interval '9 minutes');
select is((select audit_principal_id from public.legal_audit_log where seq>(select seq from ledger_before)
  and event_code='purpose.granted'),pg_temp.pseudonym('7a000000-0000-4000-8000-000000000001'),
 'a real own-report grant records the person who granted it');
insert into appended select 'owner-grant',audit_principal_id from public.legal_audit_log
 where seq>(select seq from ledger_before) and event_code='purpose.granted';
select pg_temp.next_transaction();

-- The chain hash covers the recorded actor, so attribution cannot be edited later.
select is((select count(*) from public.legal_audit_log l where l.audit_principal_id is not null
  and l.row_hash<>extensions.digest(convert_to(l.seq::text||'|'||l.occurred_at::text||'|'||l.event_code||'|'||
   l.audit_principal_id::text||'|'||coalesce(l.route_id,'')||'|'||l.outcome_code||'|'||l.coded_context::text||'|'||
   encode(l.previous_hash,'hex'),'utf8'),'sha256')),0::bigint,'every attributed row hashes its actor');
select is((select count(*) from public.legal_audit_log l join public.legal_audit_log p on p.seq=l.seq-1
  where l.seq>(select min(seq) from public.legal_audit_log where audit_principal_id is not null)-1
   and l.previous_hash<>p.row_hash),0::bigint,'and the chain stays continuous');

-- The requester's own slice.
create temporary table owner_events as select pg_temp.slice('7a000000-0000-4000-8000-000000000001',
 '7a000000-0000-4000-8000-000000000010') value;
select is((select value->>'version' from owner_events),'legal-audit-slice-v1','the slice is versioned');
select is((select (value->>'attributionStartedAt')::timestamptz from owner_events),
 (select started_at from private.legal_audit_attribution_config),'and says when attribution began');
select set_eq($$select (e->>'seq')::bigint from owner_events,jsonb_array_elements(value->'events') e$$,
 $$select seq from public.legal_audit_log where audit_principal_id=pg_temp.pseudonym('7a000000-0000-4000-8000-000000000001')$$,
 'the owner reads exactly the events it caused');
select is((select count(*) from owner_events,jsonb_array_elements(value->'events') e),4::bigint,
 'four here: two by nonce, one by account nonce and one real grant');
select is((select count(*) from owner_events,jsonb_array_elements(value->'events') e
  join public.legal_audit_log l on l.seq=(e->>'seq')::bigint
  where l.audit_principal_id is distinct from pg_temp.pseudonym('7a000000-0000-4000-8000-000000000001')),0::bigint,
 'no event of another account and none that names no one');
select ok((select bool_and(array(select jsonb_object_keys(e) order by 1)
  =array['coded_context','event_code','occurred_at','outcome_code','route_id','seq'])
  from owner_events,jsonb_array_elements(value->'events') e),'each event has exactly the listed columns, never the pseudonym or a hash');
select ok((select bool_and(x.seq>x.prior) from (select (e.value->>'seq')::bigint seq,
  lag((e.value->>'seq')::bigint,1,0::bigint) over (order by e.ordinality) prior
  from owner_events,jsonb_array_elements(owner_events.value->'events') with ordinality e) x),'in ledger order');
select is((select value->'nextAfterSeq' from owner_events),'null'::jsonb,'one page, so no cursor');
select set_eq($$select (e->>'seq')::bigint from jsonb_array_elements(pg_temp.slice('7a000000-0000-4000-8000-000000000002',
  '7a000000-0000-4000-8000-000000000011')->'events') e$$,
 $$select seq from public.legal_audit_log where audit_principal_id=pg_temp.pseudonym('7a000000-0000-4000-8000-000000000002')$$,
 'the other account reads exactly its own');

-- The same gate as the rest of the export.
select throws_ok($$select pg_temp.slice('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000011')$$,
 '42501','not_found','another account''s session is refused');
select throws_ok($$select pg_temp.slice(null,'7a000000-0000-4000-8000-000000000010')$$,'22023','invalid_request','no account is refused');
select throws_ok($$select pg_temp.slice('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000010',-1)$$,
 '22023','invalid_request','a negative cursor is refused');

-- Pages of 500 cross the API's 1,000-row cap without a gap or a repeat.
select pg_temp.consume('7a000000-0000-4000-8000-000000000001','legal-audit-owner-nonce-03');
select count(pg_temp.append('purpose.granted','api.consents')) from generate_series(1,1000);
select pg_temp.next_transaction();
create temporary table owner_pages(n integer,value jsonb);
insert into owner_pages values(1,pg_temp.slice('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000010'));
insert into owner_pages values(2,pg_temp.slice('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000010',
 (select (value->>'nextAfterSeq')::bigint from owner_pages where n=1)));
insert into owner_pages values(3,pg_temp.slice('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000010',
 (select (value->>'nextAfterSeq')::bigint from owner_pages where n=2)));
select is((select array_agg(jsonb_array_length(value->'events') order by n) from owner_pages),array[500,500,4],
 '1,004 events in three pages');
select is((select value->'nextAfterSeq' from owner_pages where n=3),'null'::jsonb,'the last page ends the read');
select is((select count(distinct e->>'seq') from owner_pages,jsonb_array_elements(value->'events') e),1004::bigint,
 'none missing or repeated');

-- Deleting the link is the pseudonymisation: the ledger is untouched (L-49).
create temporary table ledger_snapshot as select seq,audit_principal_id,row_hash from public.legal_audit_log;
savepoint unlink;
delete from private.legal_audit_account_principals where account_id='7a000000-0000-4000-8000-000000000001';
select is(jsonb_array_length(pg_temp.slice('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000010')->'events'),
 0,'once the link is gone, nothing selects the account''s events');
select set_eq('select seq,audit_principal_id,row_hash from public.legal_audit_log','select * from ledger_snapshot',
 'and every ledger row is byte-identical');
rollback to savepoint unlink;

-- The asynchronous export's legal-audit class, under a real job.
create temporary table audit_job(label text primary key,account uuid,origin jsonb,target_kind text,target uuid,
 route text,contract text,capture jsonb,created jsonb,attempt uuid);
insert into audit_job(label,account,origin,target_kind,target,route,contract,attempt)
 select label,acct,jsonb_build_object('kind','account','accountId',acct,'sessionId',sess),kind,
  case when kind='account' then acct else (select id from public.subjects where subject_account_id=acct and subject_class='self') end,
  case when kind='account' then 'api.export' else 'api.subject-export' end,
  case when kind='account' then 'account-export-v1' else 'subject-export-v1' end,attempt
 from (values ('owner','7a000000-0000-4000-8000-000000000001'::uuid,'7a000000-0000-4000-8000-000000000010'::uuid,'account',
   '7a000000-0000-4000-8000-000000000050'::uuid),
  ('other','7a000000-0000-4000-8000-000000000002'::uuid,'7a000000-0000-4000-8000-000000000011'::uuid,'account',
   '7a000000-0000-4000-8000-000000000051'::uuid),
  ('owner-subject','7a000000-0000-4000-8000-000000000001'::uuid,'7a000000-0000-4000-8000-000000000010'::uuid,'subject',
   '7a000000-0000-4000-8000-000000000052'::uuid)) v(label,acct,sess,kind,attempt);
create function pg_temp.open_job(which text,nonce text) returns void language plpgsql as $$
declare r record;
begin
 select * into r from audit_job where label=which;
 update audit_job set capture=public.export_archive_request_v1('capture',r.origin,r.target_kind,r.target) where label=which;
 select * into r from audit_job where label=which;
 update audit_job set created=public.export_archive_request_v1('create',r.origin,r.target_kind,r.target,jsonb_build_object(
  'envelope',jsonb_build_object('routeId',r.route,'origin','authenticated','principalId',r.capture->>'principalId',
   'targetKind',r.target_kind,'targetId',r.target,'exportContract',r.contract,'originBinding',r.capture->>'originBinding',
   'authorityReceipt',r.capture->>'authorityReceipt','csrfBinding',repeat('c',64),'operation','create','nonceHash',nonce,
   'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
   'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000),
  'exportCookieHash',nonce),repeat('c',64)) where label=which;
 select * into r from audit_job where label=which;
 perform public.export_archive_worker_v1('begin',(r.created->>'exportId')::uuid,r.attempt,r.capture->>'authorityReceipt');
end $$;
create function pg_temp.audit(which text,payload jsonb) returns jsonb language sql as $$
 select public.export_archive_content_v1('history',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',payload)
 from audit_job where label=which;
$$;
select pg_temp.open_job('owner',repeat('a',64));
select pg_temp.open_job('other',repeat('b',64));
select pg_temp.open_job('owner-subject',repeat('d',64));

create temporary table job_pages(n integer,value jsonb);
insert into job_pages values(1,pg_temp.audit('owner','{"kind":"legal-audit","afterSeq":null}'));
insert into job_pages values(2,pg_temp.audit('owner',jsonb_build_object('kind','legal-audit','afterSeq',
 (select (value->>'nextAfterSeq')::bigint from job_pages where n=1))));
insert into job_pages values(3,pg_temp.audit('owner',jsonb_build_object('kind','legal-audit','afterSeq',
 (select (value->>'nextAfterSeq')::bigint from job_pages where n=2))));
select set_eq($$select (r->>'seq')::bigint from job_pages,jsonb_array_elements(value->'rows') r$$,
 $$select seq from public.legal_audit_log where audit_principal_id=pg_temp.pseudonym('7a000000-0000-4000-8000-000000000001')$$,
 'the job reads exactly the owner''s own events, across pages');
select is((select value->'nextAfterSeq' from job_pages where n=3),'null'::jsonb,'and ends');
select is((select jsonb_agg(r order by (r->>'seq')::bigint) from job_pages,jsonb_array_elements(value->'rows') r),
 (select jsonb_agg(e order by (e->>'seq')::bigint) from owner_pages,jsonb_array_elements(value->'events') e),
 'the job and the synchronous export carry the same rows');
select set_eq($$select (r->>'seq')::bigint from jsonb_array_elements(pg_temp.audit('other','{"kind":"legal-audit","afterSeq":null}')->'rows') r$$,
 $$select seq from public.legal_audit_log where audit_principal_id=pg_temp.pseudonym('7a000000-0000-4000-8000-000000000002')$$,
 'the other account''s job reads exactly its own');
select throws_ok($$select pg_temp.audit('owner-subject','{"kind":"legal-audit","afterSeq":null}')$$,'22023','invalid_request',
 'an event names no subject, so a subject export refuses the class');
select throws_ok($$select pg_temp.audit('owner','{"kind":"legal-audit","afterId":null}')$$,'22023','invalid_request',
 'the class pages by sequence, not id');
select throws_ok($$select pg_temp.audit('owner','{"kind":"legal-audit","afterSeq":"7"}')$$,'22023','invalid_request',
 'a text cursor is refused');
select throws_ok($$select pg_temp.audit('owner','{"kind":"subjects","afterSeq":null}')$$,'22023','invalid_request',
 'and the other classes still page by id');

-- An event the owner causes after capture fails the owner's job and no other.
savepoint drift;
select pg_temp.consume('7a000000-0000-4000-8000-000000000001','legal-audit-owner-nonce-04');
select pg_temp.append('purpose.revoked','api.consent-revoke');
select pg_temp.next_transaction();
select throws_ok($$select pg_temp.audit('owner','{"kind":"legal-audit","afterSeq":null}')$$,'42501','not_found',
 'an event caused after capture fails the job');
select lives_ok($$select pg_temp.audit('other','{"kind":"legal-audit","afterSeq":null}')$$,'and leaves another account''s job current');
rollback to savepoint drift;
select pg_temp.append('purpose.granted','api.consents');
select lives_ok($$select pg_temp.audit('owner','{"kind":"legal-audit","afterSeq":null}')$$,
 'an event that names no one does not touch the job');
rollback to savepoint drift;

-- Planted regressions, last because they replace definitions. Each must be
-- caught by the checks above, or those checks prove nothing.
create function pg_temp.foreign_events(who uuid,sess uuid) returns bigint language sql as $$
 select count(*) from jsonb_array_elements(pg_temp.slice(who,sess)->'events') e
  join public.legal_audit_log l on l.seq=(e->>'seq')::bigint
 where l.audit_principal_id is distinct from pg_temp.pseudonym(who)
$$;
select is(pg_temp.foreign_events('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000010'),0::bigint,
 'the real slice exports no one else''s event');
savepoint planted;
create or replace function private.legal_audit_account_events_v1(p_account_id uuid,p_after_seq bigint)
returns jsonb language sql stable security definer set search_path='' as $$
 select pg_catalog.jsonb_build_object('events',coalesce(pg_catalog.jsonb_agg(x.row order by x.seq),'[]'::jsonb),'nextAfterSeq','null'::jsonb)
 from (select l.seq,pg_catalog.jsonb_build_object('seq',l.seq,'occurred_at',l.occurred_at,'event_code',l.event_code,
   'route_id',l.route_id,'outcome_code',l.outcome_code,'coded_context',l.coded_context) as row
  from public.legal_audit_log l where l.audit_principal_id is not null and l.seq>coalesce(p_after_seq,0) order by l.seq limit 500) x
$$;
select ok(pg_temp.foreign_events('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000010')>0,
 'planted: a slice without the account join exports another account''s event, and the check sees it');
rollback to savepoint planted;
create or replace function private.legal_audit_person_event_v1(p_event_code text,p_route_id text)
returns boolean language sql immutable set search_path='' as $$ select true $$;
select pg_temp.consume('7a000000-0000-4000-8000-000000000002','legal-audit-other-nonce-02');
select isnt(pg_temp.append('purpose.purge-complete','api.jobs.retention'),null::uuid,
 'planted: without the list, a system purge is attributed to a person, and the check sees it');
rollback to savepoint planted;
select pg_temp.consume('7a000000-0000-4000-8000-000000000002','legal-audit-other-nonce-03');
select is(pg_temp.append('purpose.purge-complete','api.jobs.retention'),null::uuid,'restored: the purge names no one again');

select * from finish();
rollback;
