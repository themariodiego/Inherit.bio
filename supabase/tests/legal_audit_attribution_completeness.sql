begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- G5.6, legal-audit attribution (20261023120000_legal_audit_attribution_completeness.sql),
-- owner decision of 23 October 2026 under the attribution design of 28
-- September (option A) and its one nonce rule (brief X1.5):
--   * the nine writers that consumed no nonce now run behind doors that
--     record the page's nonce first, so their events name the person who
--     acted, and a replay writes nothing;
--   * a nonce recorded already consumed names the actor too (the insert
--     trigger), which subject delete, transfer and the subject-sharing
--     operations rely on;
--   * PR 324's eight person-caused event codes are on the closed list, each
--     on its own account route; the rights-session reaffirmation stays off.
--
-- Accounts, grants, the pair and every write come from the real doors and
-- writers. The nonce hashes are synthetic: the routes verify a nonce's MAC
-- before they reach these doors (src/lib/person-operation-nonce.ts). A pgTAP
-- file is one transaction and the actor context is transaction-local, so
-- pg_temp.next_transaction() clears it where production would have
-- committed. Everything rolls back.
\ir fixtures/invitation_quota_keys.inc
update public.mail_outbox set state='invalidated' where state in ('queued','claimed');
do $$ declare n integer; begin
 for n in 1..2 loop
  insert into auth.users(id,email,email_confirmed_at) values(('7c560000-0000-4000-8000-00000000000'||n)::uuid,'attribution-'||n||'@e2e.local',now());
  insert into auth.sessions(id,user_id,created_at,updated_at,aal) values(('7c560000-0000-4000-8000-00000000001'||n)::uuid,
   ('7c560000-0000-4000-8000-00000000000'||n)::uuid,now(),now(),'aal1');
  update public.profiles set date_of_birth='1990-01-01' where id=('7c560000-0000-4000-8000-00000000000'||n)::uuid;
 end loop;
end $$;
create temporary table la(label text primary key,account uuid,session uuid,subject uuid,principal uuid);
insert into la(label,account,session) values
 ('a','7c560000-0000-4000-8000-000000000001','7c560000-0000-4000-8000-000000000011'),
 ('b','7c560000-0000-4000-8000-000000000002','7c560000-0000-4000-8000-000000000012');
update la set subject=s.id from public.subjects s where s.subject_account_id=la.account and s.subject_class='self';
update la set principal=p.id from public.subject_principals p where p.subject_id=la.subject and p.account_id=la.account
 and p.principal_kind='account_subject' and p.status='active';
create function pg_temp.v(which text,col text) returns uuid language sql stable as $$
 select case col when 'account' then account when 'session' then session when 'subject' then subject else principal end from la where label=which;
$$;
select ok((select count(*)=2 and bool_and(subject is not null and principal is not null) from la),'two real accounts with their own records');
select public.mark_independent_login_v1(account,session) from la;

create function pg_temp.next_transaction() returns void language plpgsql as $$
begin
 perform set_config('inherit.legal_audit_actor','',true);
 perform set_config('request.jwt.claims','',true);
end $$;
create function pg_temp.pseudonym(which text) returns uuid language sql as $$
 select audit_principal_id from private.legal_audit_account_principals where account_id=pg_temp.v(which,'account')
$$;
-- The newest event of one code on one route, and who it names.
create function pg_temp.actor(code text,route text) returns uuid language sql as $$
 select coalesce(audit_principal_id,'00000000-0000-0000-0000-000000000000') from public.legal_audit_log
 where event_code=code and route_id=route order by seq desc limit 1
$$;
create function pg_temp.events(code text,route text) returns bigint language sql as $$
 select count(*) from public.legal_audit_log where event_code=code and route_id=route
$$;
create function pg_temp.hash(label text) returns text language sql immutable as $$ select encode(extensions.digest(convert_to(label,'UTF8'),'sha256'),'hex') $$;
create function pg_temp.soon() returns timestamptz language sql as $$ select clock_timestamp()+interval '5 minutes' $$;
create function pg_temp.jurisdiction(which text,nonce text) returns jsonb language sql as $$
 select public.declare_jurisdiction_with_nonce_v1(pg_temp.v(which,'account'),pg_temp.v(which,'session'),'GB',null,
  (select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
  (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
  true,pg_temp.hash(nonce),pg_temp.soon())
$$;
select pg_temp.next_transaction();

-- 1. The gap: the writer alone names no one.
select public.declare_jurisdiction_v2(pg_temp.v('b','account'),pg_temp.v('b','session'),'GB',null,
 (select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),true);
select is(pg_temp.actor('jurisdiction.declared','api.jurisdiction'),'00000000-0000-0000-0000-000000000000'::uuid,
 'without a nonce, the declaration''s own event names no one, as before');
select pg_temp.next_transaction();

-- 2. Each door records the nonce first, so the writer's event names the account.
select lives_ok($$select pg_temp.jurisdiction('a','attribution-jurisdiction-a')$$,'the jurisdiction door declares');
select is(pg_temp.actor('jurisdiction.declared','api.jurisdiction'),pg_temp.pseudonym('a'),'and the declaration names the account that declared');
select is((select consumed_at is not null and operation='jurisdiction_declare' and account_id=pg_temp.v('a','account') and session_id=pg_temp.v('a','session')
 from public.account_operation_nonces where nonce_hash=pg_temp.hash('attribution-jurisdiction-a')),true,
 'the nonce is recorded once, consumed, for this account, session and operation');
select pg_temp.next_transaction();
create temporary table before_replay as select pg_temp.events('jurisdiction.declared','api.jurisdiction') n;
select throws_ok($$select pg_temp.jurisdiction('a','attribution-jurisdiction-a')$$,'22023','invalid_operation_nonce','a replayed nonce is refused');
select is(pg_temp.events('jurisdiction.declared','api.jurisdiction'),(select n from before_replay),'and writes nothing');
select pg_temp.next_transaction();
select pg_temp.jurisdiction('b','attribution-jurisdiction-b');
select pg_temp.next_transaction();

select lives_ok($$select public.declare_chromosomal_sex_with_nonce_v1(pg_temp.v('a','account'),pg_temp.v('a','session'),pg_temp.v('a','subject'),'XX',
 pg_temp.hash('attribution-sex-a'),pg_temp.soon())$$,'the chromosomal-sex door declares');
select is(pg_temp.actor('demographics.chromosomal-sex','api.chromosomal-sex'),pg_temp.pseudonym('a'),'and its event names the account');
select pg_temp.next_transaction();

-- The real Portrait grants give the pair the sharing and Portrait doors act on.
create function pg_temp.grant_portrait(owner text,recipient text,nonce text) returns uuid language sql as $$
 select public.grant_family_portrait_purpose_v1(pg_temp.v(owner,'account'),pg_temp.v(owner,'session'),pg_temp.v(owner,'subject'),
  pg_temp.v(recipient,'principal'),pg_temp.v(recipient,'account'),'family.portrait',1,
  (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),nonce,
  public.family_portrait_grant_presentation_v1(pg_temp.v(owner,'account'),pg_temp.v(owner,'session'),pg_temp.v(owner,'subject'),
   pg_temp.v(recipient,'account')));
$$;
create temporary table grants as select 'a'::text owner,pg_temp.grant_portrait('a','b','attribution-portrait-a') grant_id;
select pg_temp.next_transaction();
insert into grants select 'b',pg_temp.grant_portrait('b','a','attribution-portrait-b');
select pg_temp.next_transaction();
select ok((select count(*)=2 from grants where grant_id is not null),'both real Portrait grants exist');

select lives_ok($$select public.acknowledge_portrait_with_nonce_v1(pg_temp.v('a','account'),pg_temp.v('a','session'),pg_temp.v('a','subject'),
 pg_temp.hash('attribution-ack-a'),pg_temp.soon())$$,'the Portrait acknowledgement door acknowledges');
select is(pg_temp.actor('portrait.acknowledged','api.family-acknowledge'),pg_temp.pseudonym('a'),'and its event names the account');
select pg_temp.next_transaction();

select lives_ok($$select public.pause_family_sharing_with_nonce_v1(pg_temp.v('a','account'),pg_temp.v('a','session'),pg_temp.v('b','account'),
 pg_temp.hash('attribution-pause-a'),pg_temp.soon())$$,'the person route''s pause door pauses');
select is(pg_temp.actor('family.sharing_paused','api.family-sharing'),pg_temp.pseudonym('a'),'and the pause names the account');
select pg_temp.next_transaction();
select lives_ok($$select public.resume_family_sharing_with_nonce_v1(pg_temp.v('a','account'),pg_temp.v('a','session'),pg_temp.v('b','account'),
 pg_temp.hash('attribution-resume-a'),pg_temp.soon())$$,'the person route''s resume door resumes');
select is(pg_temp.actor('family.sharing_resumed','api.family-sharing'),pg_temp.pseudonym('a'),'and the resume names the account');
select pg_temp.next_transaction();

-- The subject route's pause and resume record their code already consumed;
-- the insert trigger is what names the account.
select lives_ok($$select public.pause_subject_sharing_v1(pg_temp.v('a','account'),pg_temp.v('a','session'),pg_temp.v('b','subject'),
 pg_temp.v('b','account'),pg_temp.hash('attribution-subject-pause-a'),pg_temp.soon())$$,'the subject route''s pause door pauses');
select is(pg_temp.actor('family.sharing_paused','api.family-sharing'),pg_temp.pseudonym('a'),'and the pause names the account');
select is((select operation from public.account_operation_nonces where nonce_hash=pg_temp.hash('attribution-subject-pause-a')),'subject_sharing_pause',
 'through the subject operation recorder');
select pg_temp.next_transaction();
select throws_ok($$select public.resume_subject_sharing_v1(pg_temp.v('a','account'),pg_temp.v('a','session'),pg_temp.v('a','subject'),
 pg_temp.v('b','account'),pg_temp.hash('attribution-subject-resume-a'),pg_temp.soon())$$,'42501',null,
 'a record that is not the counterpart''s is refused');
select lives_ok($$select public.resume_subject_sharing_v1(pg_temp.v('a','account'),pg_temp.v('a','session'),pg_temp.v('b','subject'),
 pg_temp.v('b','account'),pg_temp.hash('attribution-subject-resume-a'),pg_temp.soon())$$,'the subject route''s resume door resumes');
select is(pg_temp.actor('family.sharing_resumed','api.family-sharing'),pg_temp.pseudonym('a'),'and the resume names the account');
select pg_temp.next_transaction();
savepoint plant_no_insert_trigger;
drop trigger legal_audit_actor_on_consumed_insert on public.account_operation_nonces;
select public.pause_subject_sharing_v1(pg_temp.v('b','account'),pg_temp.v('b','session'),pg_temp.v('a','subject'),
 pg_temp.v('a','account'),pg_temp.hash('attribution-subject-pause-b'),pg_temp.soon());
select is(pg_temp.actor('family.sharing_paused','api.family-sharing'),'00000000-0000-0000-0000-000000000000'::uuid,
 'caught: without the insert trigger a code recorded consumed names no one');
rollback to plant_no_insert_trigger;
select pg_temp.next_transaction();
select is(pg_temp.actor('family.sharing_paused','api.family-sharing'),pg_temp.pseudonym('a'),'the plant was undone with its savepoint');
select pg_temp.next_transaction();

select isnt(public.revoke_directional_purpose_with_nonce_v1(pg_temp.v('a','account'),pg_temp.v('a','session'),
 (select grant_id from grants where owner='a'),pg_temp.hash('attribution-revoke-a'),pg_temp.soon()),null,'the revocation door revokes');
select is((select audit_principal_id from public.legal_audit_log where route_id='api.consent-revoke' and event_code in('purpose.revoked','purpose.purge-pending')
 order by seq desc limit 1),pg_temp.pseudonym('a'),'and the revocation names the account');
select pg_temp.next_transaction();

select is((select count(*) from public.stop_family_sharing_with_nonce_v1(pg_temp.v('a','account'),pg_temp.v('a','session'),pg_temp.v('b','account'),
 pg_temp.hash('attribution-stop-a'),pg_temp.soon())),1::bigint,'the person route''s stop door stops');
select is(pg_temp.actor('family.sharing_stopped','api.family-sharing'),pg_temp.pseudonym('a'),'and the stop names the account');
select pg_temp.next_transaction();

select is((select count(*) from public.create_adult_subject_invitation_with_nonce_v1(pg_temp.v('a','account'),pg_temp.v('a','session'),
 decode('00112233445566778899aabbccddeeff','hex'),repeat('a',64),repeat('b',64),true,null,pg_temp.invitation_quota_keys(),
 pg_temp.hash('attribution-invite-a'),pg_temp.soon())),1::bigint,'the invitation door reserves one invitation');
select is((select coalesce(bool_and(audit_principal_id=pg_temp.pseudonym('a')),false) from public.legal_audit_log
 where seq>(select coalesce(max(seq),0)-5 from public.legal_audit_log) and event_code like 'invitation.%'),true,
 'and every invitation event it wrote names the account');
select pg_temp.next_transaction();

-- 3. The doors refuse a nonce that cannot be this account's.
select throws_ok($$select public.declare_chromosomal_sex_with_nonce_v1(pg_temp.v('a','account'),pg_temp.v('b','session'),pg_temp.v('a','subject'),'XY',
 pg_temp.hash('attribution-sex-a-2'),pg_temp.soon())$$,'42501',null,'another account''s session is refused');
select throws_ok($$select public.declare_chromosomal_sex_with_nonce_v1(pg_temp.v('a','account'),pg_temp.v('a','session'),pg_temp.v('a','subject'),'XY',
 pg_temp.hash('attribution-sex-a-3'),clock_timestamp()+interval '11 minutes')$$,'22023','invalid_operation_nonce','an expiry past the nonce lifetime is refused');
select throws_ok($$select public.declare_chromosomal_sex_with_nonce_v1(pg_temp.v('a','account'),pg_temp.v('a','session'),pg_temp.v('a','subject'),'XY',
 pg_temp.hash('attribution-sex-a-4'),clock_timestamp()-interval '1 second')$$,'22023','invalid_operation_nonce','an expired nonce is refused');
select throws_ok($$select public.declare_chromosomal_sex_with_nonce_v1(pg_temp.v('a','account'),pg_temp.v('a','session'),pg_temp.v('a','subject'),'XY',
 'not-a-hash',pg_temp.soon())$$,'22023','invalid_operation_nonce','a malformed hash is refused');
select throws_ok($$select private.consume_account_operation_nonce_v1(pg_temp.v('a','account'),pg_temp.v('a','session'),'account_delete',
 pg_temp.hash('attribution-other-operation'),pg_temp.soon())$$,'22023','invalid_operation_nonce','the recorder takes only its own operations');
select is((select count(*) from public.subject_demographics where subject_id=pg_temp.v('a','subject') and chromosomal_sex='XY'),0::bigint,
 'and none of the refusals wrote anything');
select pg_temp.next_transaction();

-- 4. A nonce inserted already consumed names its account; one inserted
-- unconsumed does not.
savepoint consumed_insert;
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at,consumed_at)
 values(pg_temp.hash('attribution-inserted-unconsumed'),pg_temp.v('a','account'),pg_temp.v('a','session'),'subject_delete',pg_temp.soon(),null);
select is(private.legal_audit_actor_account_v1(),null::uuid,'an unconsumed nonce names no one');
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at,consumed_at)
 values(pg_temp.hash('attribution-inserted-consumed'),pg_temp.v('a','account'),pg_temp.v('a','session'),'subject_delete',pg_temp.soon(),clock_timestamp());
select is(private.legal_audit_actor_account_v1(),pg_temp.v('a','account'),'a nonce inserted consumed names its account');
rollback to consumed_insert;
select pg_temp.next_transaction();

-- 5. The closed list: PR 324's events on their own routes, and nothing else.
select ok(private.legal_audit_person_event_v1(code,route),code||' on '||route||' is a person''s own event') from (values
 ('consents.revoked-all','api.consents-revoke-all'),('purpose.reaffirmed','api.consent-reaffirm'),('subject.account-bound','api.adult-subject-bind'),
 ('subject.deleted','api.subject-delete'),('subject.emptied','api.subject-delete'),('subject.ownership_transferred','api.subject-transfer'),
 ('subject-draft.created','api.subject-drafts'),('download.session.created','api.subject-download'))x(code,route);
select ok(not private.legal_audit_person_event_v1(code,route),code||' on '||route||' is not') from (values
 ('purpose.reaffirmed','api.consent-reaffirm-rights'),('subject.deleted','api.withdraw'),('subject.emptied','jobs.subject-delete'),
 ('download.session.created','api.subjects'),('subject.account-bound',null))x(code,route);
select is(private.legal_audit_person_event_v1('subject.deleted',null),false,'a listed code without a route answers false, never null');
select ok(private.legal_audit_person_event_v1('jurisdiction.declared','api.jurisdiction')
 and private.legal_audit_person_event_v1('embryo.identity_profile_saved','api.future-person-identity-profile'),
 'every code the list held before is still on it');
select pg_temp.next_transaction();

-- 6. Hygiene: the doors are service-only, the recorder owner-only, and the
-- two patched bodies are exactly the reviewed successors.
select ok(has_function_privilege('service_role',f,'execute') and not has_function_privilege('anon',f,'execute')
 and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('inherit_upload_only',f,'execute'),f||' is service-only')
 from unnest(array['public.declare_jurisdiction_with_nonce_v1(uuid,uuid,text,text,integer,text,boolean,text,timestamptz)',
  'public.declare_chromosomal_sex_with_nonce_v1(uuid,uuid,uuid,text,text,timestamptz)',
  'public.pause_family_sharing_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)','public.resume_family_sharing_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)',
  'public.stop_family_sharing_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)','public.revoke_directional_purpose_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)',
  'public.acknowledge_portrait_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)',
  'public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz)',
  'public.pause_subject_sharing_v1(uuid,uuid,uuid,uuid,text,timestamptz)','public.resume_subject_sharing_v1(uuid,uuid,uuid,uuid,text,timestamptz)'])f;
select ok(not has_function_privilege(r,'private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)','execute'),
 r||' cannot record a nonce directly') from unnest(array['anon','authenticated','inherit_upload_only','service_role'])r;
select is((select array_agg(md5(pg_get_functiondef(p.oid)) order by p.oid::regprocedure::text) from pg_proc p where p.oid in(
 'private.record_subject_operation_nonce_v1(uuid,uuid,text,uuid,text,timestamptz)'::regprocedure,
 'private.legal_audit_person_event_v1(text,text)'::regprocedure)),
 (select array_agg(m order by s) from (values ('private.legal_audit_person_event_v1(text,text)','56990e96581e5dc415222f44f09b5ac0'),
  ('private.record_subject_operation_nonce_v1(uuid,uuid,text,uuid,text,timestamptz)','71a7ae8e88edc449ddf24e28973c1a14'))x(s,m)),
 'each patched function is exactly its reviewed successor');
select is((select pg_get_triggerdef(oid) from pg_trigger where tgname='legal_audit_actor_on_consumed_insert'),
 'CREATE TRIGGER legal_audit_actor_on_consumed_insert AFTER INSERT ON public.account_operation_nonces FOR EACH ROW WHEN ((new.consumed_at IS NOT NULL)) EXECUTE FUNCTION private.note_legal_audit_actor_from_nonce_v1()',
 'the insert trigger fires only for a nonce recorded consumed');

select * from finish();
rollback;
