begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
\ir fixtures/invitation_quota_keys.inc
select no_plan();
-- G5.6: who acted, for the person events whose writers consume no nonce.
-- The proof is the account's own live auth session, checked in the same
-- transaction (20260930220000). Same rule as 20260928160000: only person
-- events, never guessed, and two accounts in one transaction name no one.
-- A pgTAP file is one transaction; pg_temp.next_transaction() clears the
-- transaction-local actor where production would have committed.

insert into auth.users(id,email) values
 ('7a500000-0000-4000-8000-000000000001','session-audit-alpha@e2e.local'),
 ('7a500000-0000-4000-8000-000000000002','session-audit-beta@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) values
 ('7a500000-0000-4000-8000-000000000011','7a500000-0000-4000-8000-000000000001',now(),now(),'aal1',null),
 ('7a500000-0000-4000-8000-000000000012','7a500000-0000-4000-8000-000000000002',now(),now(),'aal1',null),
 ('7a500000-0000-4000-8000-000000000013','7a500000-0000-4000-8000-000000000001',now(),now(),'aal1',now()-interval '1 minute');
update public.profiles set date_of_birth=date '1990-01-01'
 where id in ('7a500000-0000-4000-8000-000000000001','7a500000-0000-4000-8000-000000000002');

create temporary table fx as select
 '7a500000-0000-4000-8000-000000000001'::uuid alpha, '7a500000-0000-4000-8000-000000000002'::uuid beta,
 '7a500000-0000-4000-8000-000000000011'::uuid alpha_session, '7a500000-0000-4000-8000-000000000012'::uuid beta_session,
 '7a500000-0000-4000-8000-000000000013'::uuid alpha_expired,
 (select id from public.subjects where subject_account_id='7a500000-0000-4000-8000-000000000001' and subject_class='self') alpha_subject,
 (select id from public.subjects where subject_account_id='7a500000-0000-4000-8000-000000000002' and subject_class='self') beta_subject,
 (select id from public.subject_principals where account_id='7a500000-0000-4000-8000-000000000001'
   and principal_kind='account_subject' and status='active') alpha_principal;
create temporary table mark as select coalesce(max(seq),0) seq from public.legal_audit_log;

create function pg_temp.next_transaction() returns void language plpgsql as $$
begin
 perform set_config('inherit.legal_audit_actor','',true);
 perform set_config('request.jwt.claims','',true);
 update mark set seq=(select coalesce(max(seq),0) from public.legal_audit_log);
end $$;
create function pg_temp.pseudonym(who uuid) returns uuid language sql as $$
 select audit_principal_id from private.legal_audit_account_principals where account_id=who
$$;
-- The actor of the newest event with this code since the last transaction.
create function pg_temp.actor(code text) returns uuid language sql as $$
 select audit_principal_id from public.legal_audit_log where event_code=code and seq>(select seq from mark)
 order by seq desc limit 1
$$;
create function pg_temp.appended(code text) returns bigint language sql as $$
 select count(*) from public.legal_audit_log where event_code=code and seq>(select seq from mark)
$$;
create function pg_temp.declare(who uuid,sess uuid,code text) returns jsonb language sql as $$
 select public.declare_jurisdiction_v2(who,sess,code,null,
  (select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
  (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),true)
$$;
select pg_temp.next_transaction();

-- Shape and privileges.
select ok(not has_function_privilege('service_role','private.note_legal_audit_session_actor_v1(uuid,uuid)','execute'),
 'the session recorder is reachable only through a writer');
select ok(bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute')
 and not has_function_privilege('anon',f,'execute')),
 'every v2 door is the service role''s alone') from unnest(array[
 'public.declare_chromosomal_sex_v2(uuid,uuid,uuid,text)',
 'public.pause_family_sharing_v2(uuid,uuid,uuid)','public.resume_family_sharing_v2(uuid,uuid,uuid)',
 'public.stop_family_sharing_v2(uuid,uuid,uuid)','public.revoke_directional_purpose_v2(uuid,uuid,uuid)',
 'public.acknowledge_portrait_v2(uuid,uuid,uuid)',
 'public.create_adult_subject_invitation_v2(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb)',
 'public.respond_adult_subject_invitation_session_v2(text,text,text,uuid,uuid,jsonb)']) f;
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like '%\_v2' and p.oid::regprocedure::text = any(array[
 'declare_chromosomal_sex_v2(uuid,uuid,uuid,text)','pause_family_sharing_v2(uuid,uuid,uuid)',
 'acknowledge_portrait_v2(uuid,uuid,uuid)']) and not p.prosecdef),3::bigint,'the public doors are invokers');

-- Jurisdiction: the live session it already checked now names the actor.
select pg_temp.declare((select alpha from fx),(select alpha_session from fx),'XX');
select is(pg_temp.actor('jurisdiction.declared'),pg_temp.pseudonym((select alpha from fx)),
 'a jurisdiction declaration names the account whose live session made it');
select isnt(pg_temp.pseudonym((select alpha from fx)),(select alpha from fx),'by pseudonym, never by account id');
select pg_temp.next_transaction();
select throws_ok($$select pg_temp.declare((select alpha from fx),(select beta_session from fx),'XX')$$,'42501','not_found',
 'another account''s session cannot declare for this one');
select throws_ok($$select pg_temp.declare((select alpha from fx),(select alpha_expired from fx),'XX')$$,'42501','not_found',
 'nor can an expired session');
select is(pg_temp.appended('jurisdiction.declared')+pg_temp.appended('jurisdiction.reaffirmed'),0::bigint,'refusals append nothing');
select pg_temp.next_transaction();

-- Chromosomal sex: v2 proves the session; v1 still names no one.
select public.declare_chromosomal_sex_v1((select alpha from fx),(select alpha_subject from fx),'XX');
select is(pg_temp.actor('demographics.chromosomal-sex'),null::uuid,'v1 takes no session, so its event names no one');
select pg_temp.next_transaction();
select public.declare_chromosomal_sex_v2((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),'XY');
select is(pg_temp.actor('demographics.chromosomal-sex'),pg_temp.pseudonym((select alpha from fx)),
 'v2 names the account whose session it proved');
select pg_temp.next_transaction();
select throws_ok($$select public.declare_chromosomal_sex_v2((select alpha from fx),(select beta_session from fx),(select alpha_subject from fx),null)$$,
 '42501','not_found','a session that is not the account''s refuses the declaration');
select throws_ok($$select public.declare_chromosomal_sex_v2((select alpha from fx),null,(select alpha_subject from fx),null)$$,
 '42501','not_found','and so does a missing session');
select is(pg_temp.appended('demographics.chromosomal-sex'),0::bigint,'a refused declaration appends nothing');
select pg_temp.next_transaction();

-- Family sharing: Beta shares with Alpha, then each acts in turn.
create temporary table shared as select public.grant_directional_purpose_v1(
 (select beta from fx),(select beta_subject from fx),(select alpha_principal from fx),
 'reports.polygenic','consent.share-with-adult',1,'session-audit-nonce-0001-aaaa') as grant_id;
select pg_temp.next_transaction();
select public.pause_family_sharing_v2((select alpha from fx),(select alpha_session from fx),(select beta from fx));
select is(pg_temp.actor('family.sharing_paused'),pg_temp.pseudonym((select alpha from fx)),'a pause names who paused');
select pg_temp.next_transaction();
select public.resume_family_sharing_v2((select alpha from fx),(select alpha_session from fx),(select beta from fx));
select is(pg_temp.actor('family.sharing_resumed'),pg_temp.pseudonym((select alpha from fx)),'a resume names who resumed');
select pg_temp.next_transaction();

-- Two accounts in one transaction: the second act names no one.
select public.pause_family_sharing_v2((select alpha from fx),(select alpha_session from fx),(select beta from fx));
select public.revoke_directional_purpose_v2((select beta from fx),(select beta_session from fx),(select grant_id from shared));
select is(pg_temp.actor('purpose.revoked'),null::uuid,'a second account in the same transaction makes the event name no one');
select pg_temp.next_transaction();

-- Revocation on its own names the revoker, and its purge stays the service's.
select public.resume_family_sharing_v1((select alpha from fx),(select beta from fx));
select pg_temp.next_transaction();
create temporary table shared_again as select public.grant_directional_purpose_v1(
 (select beta from fx),(select beta_subject from fx),(select alpha_principal from fx),
 'reports.polygenic','consent.share-with-adult',1,'session-audit-nonce-0002-aaaa') as grant_id;
select pg_temp.next_transaction();
select public.revoke_directional_purpose_v2((select beta from fx),(select beta_session from fx),(select grant_id from shared_again));
select is(pg_temp.actor('purpose.revoked'),pg_temp.pseudonym((select beta from fx)),'a revocation names who revoked');
select ok(not exists(select 1 from public.legal_audit_log where seq>(select seq from mark)
 and event_code not in ('purpose.revoked') and audit_principal_id is not null),
 'no event off the person list in that transaction names anyone');
select pg_temp.next_transaction();

-- Stop sharing and the Portrait acknowledgement.
create temporary table shared_third as select public.grant_directional_purpose_v1(
 (select beta from fx),(select beta_subject from fx),(select alpha_principal from fx),
 'reports.polygenic','consent.share-with-adult',1,'session-audit-nonce-0003-aaaa') as grant_id;
select pg_temp.next_transaction();
select lives_ok($$select * from public.stop_family_sharing_v2((select alpha from fx),(select alpha_session from fx),(select beta from fx))$$,
 'stopping sharing through v2');
select is(pg_temp.actor('family.sharing_stopped'),pg_temp.pseudonym((select alpha from fx)),'a stop names who stopped');
select pg_temp.next_transaction();
select lives_ok($$select public.acknowledge_portrait_v2((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx))$$,
 'acknowledging Portrait through v2');
select is(pg_temp.actor('portrait.acknowledged'),pg_temp.pseudonym((select alpha from fx)),'the acknowledgement names who acknowledged');
select pg_temp.next_transaction();

-- The adult-subject invitation names the inviter.
select lives_ok($$select * from public.create_adult_subject_invitation_v2((select alpha from fx),(select alpha_session from fx),
 decode('00112233445566778899aabbccddeeff','hex'),repeat('a',64),repeat('b',64),true,null,pg_temp.invitation_quota_keys())$$,
 'inviting through v2');
select is(pg_temp.actor('invitation.issued'),pg_temp.pseudonym((select alpha from fx)),'the invitation names who invited');
select pg_temp.next_transaction();

-- The adult-subject response: an account needs its session; without an
-- account (refuse or delete from the rights session) nothing is proved.
select throws_ok($$select public.respond_adult_subject_invitation_session_v2(repeat('c',64),'confirm','n',(select alpha from fx),null,null)$$,
 '42501','not_found','a confirmation that names an account must prove its session');
select throws_ok($$select public.respond_adult_subject_invitation_session_v2(repeat('c',64),'refuse','n',null,(select alpha_session from fx),null)$$,
 '42501','not_found','and a session with no account proves nothing');

select * from finish();
rollback;
