begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic metadata only; every fixture and assertion rolls back. The owner
-- holds 1,003 legacy consents, more than the API's 1,000-row cap, so the
-- keyset pages must cross it without omitting or repeating a row. A second
-- account holds rows of the same classes, which must never appear.
insert into auth.users(id,email) values
 ('79900000-0000-4000-8000-000000000001','history-owner@e2e.local'),
 ('79900000-0000-4000-8000-000000000002','history-other@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('79900000-0000-4000-8000-000000000010','79900000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('79900000-0000-4000-8000-000000000011','79900000-0000-4000-8000-000000000002',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='79900000-0000-4000-8000-000000000001';
create temporary table self_subject as select subject_account_id account,id from public.subjects
 where subject_account_id in ('79900000-0000-4000-8000-000000000001','79900000-0000-4000-8000-000000000002')
  and subject_class='self';
create function pg_temp.subject_of(who uuid) returns uuid language sql as $$ select id from self_subject where account=who $$;

-- Real signed consents for the owner, through the upload signing function.
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'79900000-0000-4000-8000-000000000001','79900000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('79900000-0000-4000-8000-000000000001','79900000-0000-4000-8000-000000000010',
 pg_temp.subject_of('79900000-0000-4000-8000-000000000001'),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('79900000-0000-4000-8000-000000000001','79900000-0000-4000-8000-000000000010',
 pg_temp.subject_of('79900000-0000-4000-8000-000000000001'),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));

-- Legacy consents: 1,003 for the owner (only the last one still current) and
-- two for the other account.
insert into public.consent_grants(id,user_id,provider_key,data_classes,granted_at,revoked_at)
 select format('79910000-0000-4000-8000-%s',lpad(n::text,12,'0'))::uuid,'79900000-0000-4000-8000-000000000001',
  'provider-'||n,array['variants'],clock_timestamp()-interval '2 days',
  case when n<1003 then clock_timestamp()-interval '1 day' end from generate_series(1,1003) n;
insert into public.consent_grants(id,user_id,provider_key,data_classes) values
 ('79920000-0000-4000-8000-000000000001','79900000-0000-4000-8000-000000000002','other-a',array['variants']),
 ('79920000-0000-4000-8000-000000000002','79900000-0000-4000-8000-000000000002','other-b',array['reports']);
insert into public.subject_demographics(subject_id,date_of_birth,chromosomal_sex,demographics_revision) values
 (pg_temp.subject_of('79900000-0000-4000-8000-000000000001'),date '1990-01-01','XX',1),
 (pg_temp.subject_of('79900000-0000-4000-8000-000000000002'),date '1985-01-01','XY',1);
-- One recipient grant per account. The local stack seeds no provider, so a
-- synthetic one is added; purpose and artifact are real reference rows.
insert into public.providers(slug,name,website,checkout_url,ships_to,last_verified_at)
 values('history-fixture','History fixture','https://example.invalid','https://example.invalid/checkout','nowhere',date '2026-09-25')
 on conflict (slug) do nothing;
insert into public.provider_recipient_grants(id,account_id,recipient_principal_id,provider_id,purpose,artifact_key,
 artifact_version,grant_revision,model_recipient_revision,status)
 select format('7993000%s-0000-4000-8000-000000000001',k)::uuid,acct,
  (select id from public.subject_principals where account_id=acct and subject_id=pg_temp.subject_of(acct) limit 1),
  'history-fixture',(select purpose from public.consent_purposes order by purpose limit 1),
  (select artifact_key from public.consent_artifacts order by artifact_key,version limit 1),
  (select version from public.consent_artifacts order by artifact_key,version limit 1),1,1,'current'
 from (values (1,'79900000-0000-4000-8000-000000000001'::uuid),(2,'79900000-0000-4000-8000-000000000002'::uuid)) v(k,acct);
select is((select count(*) from public.provider_recipient_grants where id::text like '7993000%'),2::bigint,
 'fixture: one recipient grant per account');

-- Jobs through the real request and worker RPCs: an account export for each
-- account and a subject export for the owner's own subject.
create temporary table history_job(label text primary key,account uuid,origin jsonb,target_kind text,target uuid,
 route text,contract text,capture jsonb,created jsonb,attempt uuid);
insert into history_job(label,account,origin,target_kind,target,route,contract,attempt)
 select label,acct,jsonb_build_object('kind','account','accountId',acct,'sessionId',sess),kind,
  case when kind='account' then acct else pg_temp.subject_of(acct) end,
  case when kind='account' then 'api.export' else 'api.subject-export' end,
  case when kind='account' then 'account-export-v1' else 'subject-export-v1' end,attempt
 from (values ('owner','79900000-0000-4000-8000-000000000001'::uuid,'79900000-0000-4000-8000-000000000010'::uuid,'account',
   '79900000-0000-4000-8000-000000000050'::uuid),
  ('other','79900000-0000-4000-8000-000000000002'::uuid,'79900000-0000-4000-8000-000000000011'::uuid,'account',
   '79900000-0000-4000-8000-000000000051'::uuid),
  ('owner-subject','79900000-0000-4000-8000-000000000001'::uuid,'79900000-0000-4000-8000-000000000010'::uuid,'subject',
   '79900000-0000-4000-8000-000000000052'::uuid)) v(label,acct,sess,kind,attempt);
create function pg_temp.open_job(which text,nonce text) returns void language plpgsql as $$
declare r record;
begin
 select * into r from history_job where label=which;
 update history_job set capture=public.export_archive_request_v1('capture',r.origin,r.target_kind,r.target) where label=which;
 select * into r from history_job where label=which;
 update history_job set created=public.export_archive_request_v1('create',r.origin,r.target_kind,r.target,jsonb_build_object(
  'envelope',jsonb_build_object('routeId',r.route,'origin','authenticated','principalId',r.capture->>'principalId',
   'targetKind',r.target_kind,'targetId',r.target,'exportContract',r.contract,'originBinding',r.capture->>'originBinding',
   'authorityReceipt',r.capture->>'authorityReceipt','csrfBinding',repeat('c',64),'operation','create','nonceHash',nonce,
   'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
   'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000),
  'exportCookieHash',nonce),repeat('c',64)) where label=which;
 select * into r from history_job where label=which;
 perform public.export_archive_worker_v1('begin',(r.created->>'exportId')::uuid,r.attempt,r.capture->>'authorityReceipt');
end $$;
create function pg_temp.history(which text,kind text,after_id uuid default null) returns jsonb language sql as $$
 select public.export_archive_content_v1('history',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',
  jsonb_build_object('kind',kind,'afterId',after_id)) from history_job where label=which;
$$;
create function pg_temp.raw(which text,payload jsonb) returns jsonb language sql as $$
 select public.export_archive_content_v1('history',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',payload)
 from history_job where label=which;
$$;
create function pg_temp.state() returns jsonb language sql as $$
 select jsonb_build_object('jobs',(select jsonb_agg(to_jsonb(j) order by j.export_id) from private.export_archive_jobs j),
  'attempts',(select jsonb_agg(to_jsonb(a) order by a.id) from private.export_archive_attempts a),
  'exports',(select jsonb_agg(to_jsonb(e) order by e.id) from public.generated_exports e),
  'nonces',(select count(*) from private.export_archive_nonce_uses),
  'segments',(select count(*) from private.export_archive_segments),
  'downloads',(select count(*) from private.export_archive_downloads),
  'history',(select count(*) from public.consent_grants)+(select count(*) from public.subject_consents));
$$;

select pg_temp.open_job('owner',repeat('a',64));
select pg_temp.open_job('other',repeat('b',64));
select pg_temp.open_job('owner-subject',repeat('d',64));
create temporary table before_reads as select pg_temp.state() value;

-- The receipt is the new graph version, and it hashes history.
select is((select authority_receipt from private.export_archive_jobs j join history_job h on h.created->>'exportId'=j.export_id::text
 where h.label='owner'),(select capture->>'authorityReceipt' from history_job where label='owner'),
 'the job pins the receipt captured under the v2 graph');

-- Legacy consents cross the 1,000-row cap in three keyset pages.
create temporary table legacy_pages(n integer,value jsonb);
insert into legacy_pages values(1,pg_temp.history('owner','legacy-consents'));
insert into legacy_pages values(2,pg_temp.history('owner','legacy-consents',((select value->>'nextAfterId' from legacy_pages where n=1))::uuid));
insert into legacy_pages values(3,pg_temp.history('owner','legacy-consents',((select value->>'nextAfterId' from legacy_pages where n=2))::uuid));
select is((select jsonb_array_length(value->'rows') from legacy_pages where n=1),500,'the first legacy page is bounded at 500');
select is((select jsonb_array_length(value->'rows') from legacy_pages where n=2),500,'the second legacy page is full');
select is((select jsonb_array_length(value->'rows') from legacy_pages where n=3),3,'the third legacy page holds the remainder');
select is((select value->'nextAfterId' from legacy_pages where n=3),'null'::jsonb,'the last page has no next cursor');
select is((select value->>'nextAfterId' from legacy_pages where n=1),
 (select value->'rows'->499->>'id' from legacy_pages where n=1),'the cursor is the last id of the page');
create temporary table legacy_rows as select (r->>'id')::uuid id,r from legacy_pages,jsonb_array_elements(value->'rows') r;
select is((select count(*) from legacy_rows),1003::bigint,'every legacy consent is read');
select is((select count(distinct id) from legacy_rows),1003::bigint,'no legacy consent is read twice');
select set_eq('select id from legacy_rows',
 $$select id from public.consent_grants where user_id='79900000-0000-4000-8000-000000000001'$$,
 'the pages are exactly the owner''s legacy consents');
select is((select count(*) from legacy_rows where id::text like '79920000%'),0::bigint,'no other account''s legacy consent appears');
select ok((select bool_and(prev<id) from (select (r->>'id')::uuid id,lag((r->>'id')::uuid) over (order by p.n,o) prev
 from legacy_pages p,jsonb_array_elements(p.value->'rows') with ordinality t(r,o)) x where prev is not null),
 'rows arrive in strictly increasing id order across pages');
select is((select array_agg(k order by k) from jsonb_object_keys((select r from legacy_rows limit 1)) k),
 array['data_classes','granted_at','id','provider_key','revoked_at'],'a legacy row carries exactly the listed columns');
select is((select r from legacy_rows where id='79910000-0000-4000-8000-000000001003'::uuid)->'revoked_at','null'::jsonb,
 'the current legacy consent reads as not revoked');

-- The other classes, each scoped as the synchronous subject record scopes it.
select is(pg_temp.history('owner','subjects')->'rows'->0->>'id',
 pg_temp.subject_of('79900000-0000-4000-8000-000000000001')::text,'subjects is the owner''s captured partition');
select is(jsonb_array_length(pg_temp.history('owner','subjects')->'rows'),1,'and only that one subject');
select ok(not (pg_temp.history('owner','subjects')->'rows'->0 ?| array['owner_account_id','subject_account_id','cohort_id']),
 'a subject row names no account and no cohort');
select is(pg_temp.history('owner','demographics')->'rows',jsonb_build_array(jsonb_build_object(
 'subject_id',pg_temp.subject_of('79900000-0000-4000-8000-000000000001'),'date_of_birth','1990-01-01','chromosomal_sex','XX',
 'demographics_revision',1,'updated_at',(select updated_at from public.subject_demographics
  where subject_id=pg_temp.subject_of('79900000-0000-4000-8000-000000000001')))),'demographics is the owner''s own row only');
select set_eq($$select (r->>'id')::uuid from jsonb_array_elements(pg_temp.history('owner','principals')->'rows') r$$,
 $$select id from public.subject_principals where account_id='79900000-0000-4000-8000-000000000001'$$,
 'principals are exactly the owner''s');
select set_eq($$select (r->>'id')::uuid from jsonb_array_elements(pg_temp.history('owner','bindings')->'rows') r$$,
 $$select id from public.subject_account_bindings where account_id='79900000-0000-4000-8000-000000000001'$$,
 'bindings are exactly the owner''s');
select set_eq($$select (r->>'id')::uuid from jsonb_array_elements(pg_temp.history('owner','account-consents')->'rows') r$$,
 $$select id from public.subject_consents where account_id='79900000-0000-4000-8000-000000000001'$$,
 'account-keyed consents are exactly the owner''s');
select ok((select bool_or(r->>'consent_type'='upload_class' and r->'scope'='["store"]'::jsonb)
 from jsonb_array_elements(pg_temp.history('owner','account-consents')->'rows') r),
 'the signed upload consent is among them');
select is(pg_temp.history('owner','recipient-grants')->'rows'->0->>'id','79930001-0000-4000-8000-000000000001',
 'recipient grants are the owner''s');
select is(jsonb_array_length(pg_temp.history('owner','recipient-grants')->'rows'),1,'and only the owner''s');

-- The other account reads its own rows and none of the owner's.
select set_eq($$select (r->>'id')::uuid from jsonb_array_elements(pg_temp.history('other','legacy-consents')->'rows') r$$,
 array['79920000-0000-4000-8000-000000000001'::uuid,'79920000-0000-4000-8000-000000000002'::uuid],
 'the other account reads exactly its own two legacy consents');
select is(pg_temp.history('other','demographics')->'rows'->0->>'chromosomal_sex','XY','and its own demographics');
select is(pg_temp.history('other','recipient-grants')->'rows'->0->>'id','79930002-0000-4000-8000-000000000001',
 'and its own recipient grant');

-- A subject export keeps rows about that subject and refuses account-level classes.
select throws_ok($$select pg_temp.history('owner-subject','legacy-consents')$$,'22023','invalid_request',
 'legacy consents are not part of a subject export');
select throws_ok($$select pg_temp.history('owner-subject','recipient-grants')$$,'22023','invalid_request',
 'recipient grants are not part of a subject export');
select ok((select bool_and(r->>'subject_id'=pg_temp.subject_of('79900000-0000-4000-8000-000000000001')::text)
 from jsonb_array_elements(pg_temp.history('owner-subject','account-consents')->'rows') r),
 'a subject export''s consents are all about that subject');
select is(jsonb_array_length(pg_temp.history('owner-subject','subjects')->'rows'),1,'a subject export reads its one subject');

-- Closed payloads.
select throws_ok($$select pg_temp.raw('owner','{"kind":"legacy-consents"}')$$,'22023','invalid_request','afterId is required');
select throws_ok($$select pg_temp.raw('owner','{"kind":"chats","afterId":null}')$$,'22023','invalid_request','an unknown kind is refused');
select throws_ok($$select pg_temp.raw('owner','{"kind":"legacy-consents","afterId":null,"limit":5000}')$$,'22023','invalid_request',
 'no caller-chosen page size');
select throws_ok($$select pg_temp.raw('owner','{"kind":"legacy-consents","afterId":"not-a-uuid"}')$$,'22023','invalid_request',
 'a malformed cursor is refused');
select throws_ok($$select pg_temp.raw('owner','{"kind":"legacy-consents","afterId":7}')$$,'22023','invalid_request',
 'a numeric cursor is refused');
select throws_ok($$select pg_temp.raw('owner',null)$$,'22023','invalid_request','a missing payload is refused');

-- Reading wrote nothing.
select is(pg_temp.state(),(select value from before_reads),'history reads leave jobs, attempts, exports, nonces and rows unchanged');

-- A change after capture fails the job: the receipt now describes history.
savepoint drift;
insert into public.consent_grants(user_id,provider_key,data_classes) values('79900000-0000-4000-8000-000000000001','late',array['variants']);
select throws_ok($$select pg_temp.history('owner','subjects')$$,'42501','not_found','a legacy consent added after capture fails the job');
rollback to savepoint drift;
update public.consent_grants set revoked_at=clock_timestamp() where id='79910000-0000-4000-8000-000000001003';
select throws_ok($$select pg_temp.history('owner','legacy-consents')$$,'42501','not_found','a legacy consent revoked after capture fails the job');
rollback to savepoint drift;
update public.subject_demographics set chromosomal_sex='unknown',demographics_revision=2
 where subject_id=pg_temp.subject_of('79900000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.history('owner','demographics')$$,'42501','not_found','a demographics edit after capture fails the job');
rollback to savepoint drift;
update public.provider_recipient_grants set status='revoked',ended_at=clock_timestamp() where id='79930001-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.history('owner','recipient-grants')$$,'42501','not_found','a recipient grant ended after capture fails the job');
rollback to savepoint drift;
select lives_ok($$select pg_temp.history('owner','legacy-consents')$$,'after the rollback the unchanged job reads again');
-- Another account's change does not touch this job.
insert into public.consent_grants(user_id,provider_key,data_classes) values('79900000-0000-4000-8000-000000000002','later',array['variants']);
select lives_ok($$select pg_temp.history('owner','legacy-consents')$$,'another account''s new legacy consent leaves this job current');
select throws_ok($$select pg_temp.history('other','legacy-consents')$$,'42501','not_found','and fails that account''s own job');
rollback to savepoint drift;

-- Job, attempt and lease bindings hold for the new operation.
select throws_ok($$select public.export_archive_content_v1('history',(created->>'exportId')::uuid,attempt,repeat('f',64),
 '{"kind":"subjects","afterId":null}') from history_job where label='owner'$$,'42501','not_found','a wrong receipt is refused');
select throws_ok($$select public.export_archive_content_v1('history',(o.created->>'exportId')::uuid,x.attempt,o.capture->>'authorityReceipt',
 '{"kind":"subjects","afterId":null}') from history_job o,history_job x where o.label='owner' and x.label='other'$$,
 '42501','not_found','another job''s attempt is refused');
-- Clock movement is fixture metadata, not a provider or wall-clock claim.
update private.export_archive_attempts set lease_expires_at=clock_timestamp()-interval '1 second',
 started_at=clock_timestamp()-interval '2 seconds' where id='79900000-0000-4000-8000-000000000050';
select throws_ok($$select pg_temp.history('owner','subjects')$$,'42501','not_found','an expired lease is refused');
rollback to savepoint drift;

-- Browser roles cannot call the reader at all.
select ok(not has_function_privilege('authenticated','public.export_archive_content_v1(text,uuid,uuid,text,jsonb)','execute'),
 'authenticated cannot execute the reader');
select ok(not has_function_privilege('anon','public.export_archive_content_v1(text,uuid,uuid,text,jsonb)','execute'),
 'anon cannot execute the reader');

select * from finish();
rollback;
