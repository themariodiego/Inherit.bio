begin;
select no_plan();
-- Synthetic accounts; every write and invitation fixture rolls back.
insert into auth.users(id,email,raw_user_meta_data) values
 ('76100000-0000-4000-8000-000000000001','own-completion@e2e.local','{"display_name":"Completion"}'),
 ('76100000-0000-4000-8000-000000000002','own-inviter@e2e.local','{"display_name":"Inviter"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('76100000-0000-4000-8000-000000000010','76100000-0000-4000-8000-000000000001',now()-interval '1 hour',now(),'aal1'),
 ('76100000-0000-4000-8000-000000000011','76100000-0000-4000-8000-000000000002',now(),now(),'aal1');
create temporary table completion_target as
 select id,1::bigint as subject_revision,1::bigint as binding_revision from public.subjects
 where subject_account_id='76100000-0000-4000-8000-000000000001' and subject_class='self';
grant select on completion_target to service_role;
create function pg_temp.completion_context() returns jsonb language sql as $$
 select public.own_upload_context_v1('76100000-0000-4000-8000-000000000001',
 '76100000-0000-4000-8000-000000000010',(select id from completion_target));
$$;
-- Brief X1.5: nothing issues a nonce ahead of use any more. The v1 body
-- assertions below still need a stored row, so the fixture writes one
-- directly, as the other own-upload tests do; the route's v2 path records its
-- own and is exercised through pg_temp.complete_v2.
create function pg_temp.store_nonce(p_nonce text,p_operation text default 'own_account_completion')
 returns void language sql as $$
 insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 values(p_nonce,'76100000-0000-4000-8000-000000000001','76100000-0000-4000-8000-000000000010',
 p_operation,clock_timestamp()+interval '9 minutes');
$$;
create function pg_temp.complete_v2(p_date date,p_nonce text,p_revision bigint default 1,
 p_expiry timestamptz default clock_timestamp()+interval '9 minutes')
 returns jsonb language sql as $$
 select public.complete_own_upload_account_v2('76100000-0000-4000-8000-000000000001',
 '76100000-0000-4000-8000-000000000010',(select id from completion_target),p_revision,1,1,
 (select subject_revision from completion_target),(select binding_revision from completion_target),p_date,p_nonce,p_expiry);
$$;
create function pg_temp.complete_account(p_date date,p_nonce text,p_revision bigint default 1)
 returns jsonb language sql as $$
 select public.complete_own_upload_account_v1('76100000-0000-4000-8000-000000000001',
 '76100000-0000-4000-8000-000000000010',(select id from completion_target),p_revision,1,1,
 (select subject_revision from completion_target),(select binding_revision from completion_target),p_date,p_nonce);
$$;
select is(pg_temp.completion_context(),jsonb_build_object('accountRevision',1,'authSessionRevision',1,
 'jurisdictionRevision',1,'subjectBindingRevision',1,'accountBindingRevision',1,'birthDateState','missing'),
 'the presentation context is closed and contains no birth date or identity fields');
set local role service_role;
select throws_ok($$select pg_temp.complete_v2(date '1990-01-01','short')$$,
 '42501','not_found','nonce digests must have the exact shape');
select throws_ok($$select pg_temp.complete_v2(date '1990-01-01',repeat('a',64),1,clock_timestamp()+interval '11 minutes')$$,
 '42501','not_found','a presentation cannot extend the ten-minute lifetime');
select throws_ok($$select pg_temp.complete_v2(date '1990-01-01',repeat('a',64),1,clock_timestamp()-interval '1 second')$$,
 '42501','not_found','an already expired presentation is refused');
select throws_ok($$select public.sign_own_upload_artifact_v2('76100000-0000-4000-8000-000000000001',
 '76100000-0000-4000-8000-000000000010',(select id from completion_target),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64),clock_timestamp()+interval '9 minutes')$$,
 '55000','adult_account_required','missing adult details cannot sign a consent');
select throws_ok($$select pg_temp.complete_v2(date '1990-01-01',repeat('a',64),2)$$,
 '42501','not_found','the completion POST rechecks the account revision');
reset role;
select is((select count(*) from public.account_operation_nonces
 where account_id='76100000-0000-4000-8000-000000000001'),0::bigint,
 'nothing stores a presentation nonce ahead of use, and every refusal above recorded none');
select pg_temp.store_nonce(repeat('a',64));
select throws_ok($$select pg_temp.complete_account((timezone('UTC',clock_timestamp())::date-interval '18 years')::date+1,repeat('a',64))$$,
 '22023','adult_account_required','a person who turns eighteen tomorrow cannot complete yet');
select throws_ok($$select pg_temp.complete_account(null,repeat('a',64))$$,
 '22023','adult_account_required','a missing date cannot be saved');
select throws_ok($$select pg_temp.complete_account(date '1990-01-01',repeat('b',64))$$,
 '42501','not_found','completion requires an issued nonce');
select throws_ok($$select pg_temp.complete_account(date '1990-01-01',repeat('a',64),2)$$,
 '42501','not_found','completion rechecks the snapshot instead of trusting a former screen');
select ok((select consumed_at is null from public.account_operation_nonces where nonce_hash=repeat('a',64)),
 'refused declarations do not consume the valid presentation');
select ok((select date_of_birth is null and account_revision=1 from public.profiles
 where id='76100000-0000-4000-8000-000000000001'),'refused declarations do not alter the account');
update public.profiles set deletion_requested_at=clock_timestamp() where id='76100000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.complete_account(date '1990-01-01',repeat('a',64))$$,
 '42501','not_found','deletion hold refuses completion');
update public.profiles set deletion_requested_at=null,auth_session_revision=2 where id='76100000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.complete_account(date '1990-01-01',repeat('a',64))$$,
 '42501','not_found','revoked account-session authority refuses completion');
update public.profiles set auth_session_revision=1,jurisdiction_revision=2 where id='76100000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.complete_account(date '1990-01-01',repeat('a',64))$$,
 '42501','not_found','jurisdiction revision changes invalidate the presentation');
update public.profiles set jurisdiction_revision=1 where id='76100000-0000-4000-8000-000000000001';
update public.subject_account_bindings set binding_revision=2 where subject_id=(select id from completion_target) and status='current';
select throws_ok($$select pg_temp.complete_account(date '1990-01-01',repeat('a',64))$$,
 '42501','not_found','account-binding changes invalidate the presentation independently');
update public.subject_account_bindings set binding_revision=1 where subject_id=(select id from completion_target) and status='current';
update public.account_operation_nonces set operation='own_upload_artifact_sign' where nonce_hash=repeat('a',64);
select throws_ok($$select pg_temp.complete_account(date '1990-01-01',repeat('a',64))$$,
 '42501','not_found','signing authority cannot stand in for account completion');
update public.account_operation_nonces set operation='own_account_completion',session_id='76100000-0000-4000-8000-000000000011'
 where nonce_hash=repeat('a',64);
select throws_ok($$select pg_temp.complete_account(date '1990-01-01',repeat('a',64))$$,
 '42501','not_found','a different session cannot supply the nonce');
update public.account_operation_nonces set session_id='76100000-0000-4000-8000-000000000010',
 issued_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '10 minutes' where nonce_hash=repeat('a',64);
select throws_ok($$select pg_temp.complete_account(date '1990-01-01',repeat('a',64))$$,
 '42501','not_found','expiry is enforced at the database mutation');
-- The route's path: nothing stored beforehand, v2 records and spends it.
delete from public.account_operation_nonces where nonce_hash=repeat('a',64);
set local role service_role;
select is(pg_temp.complete_v2((timezone('UTC',clock_timestamp())::date-interval '18 years')::date,repeat('a',64)),
 '{"status":"completed"}'::jsonb,'the exact eighteenth birthday completes with a closed receipt');
reset role;
select is((select account_revision from public.profiles where id='76100000-0000-4000-8000-000000000001'),2::bigint,
 'saving the date increments the account revision exactly once');
select ok((select consumed_at is not null from public.account_operation_nonces where nonce_hash=repeat('a',64)),
 'the successful presentation is consumed atomically');
select is((select operation from public.account_operation_nonces where nonce_hash=repeat('a',64)),'own_account_completion',
 'the completion route records its nonce as a completion, never as another operation such as account deletion');
select is(pg_temp.completion_context()->>'birthDateState','adult','the next screen sees an adult account without receiving the date');
select throws_ok($$select pg_temp.complete_account(date '1990-01-01',repeat('a',64))$$,
 '42501','not_found','the old account snapshot cannot replay');
select throws_ok($$select pg_temp.complete_account(date '1990-01-01',repeat('a',64),2)$$,
 '55000','account_already_completed','even the current snapshot cannot overwrite a stored date');
select is((select count(*) from public.consent_signatures where signer_account_id='76100000-0000-4000-8000-000000000001'),
 0::bigint,'account completion records no consent');
select is((select count(*) from public.purpose_grants where target_id=(select id from completion_target)),
 0::bigint,'account completion authorizes no analysis');
select is((select count(*) from public.genome_files where subject_id=(select id from completion_target)),
 0::bigint,'account completion creates no genetic file');
set local role service_role;
select lives_ok($$select public.sign_own_upload_artifact_v2('76100000-0000-4000-8000-000000000001',
 '76100000-0000-4000-8000-000000000010',(select id from completion_target),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],2,1,1,1,1,repeat('b',64),clock_timestamp()+interval '9 minutes')$$,
 'the completed account can proceed to its separately presented consent decision');
reset role;

-- Exercise the real acceptance transition. Token issuance is a scoped synthetic
-- delivery fixture, not a mail-worker test; no unrelated outbox row is claimed.
create temporary table completion_invitation as select * from public.create_adult_subject_invitation_v1(
 '76100000-0000-4000-8000-000000000002',decode('00112233445566778899aabbccddeeff','hex'),
 repeat('c',64),repeat('d',64),true);
update public.token_candidates set state='issued'
 where target_id=(select invitation_id from completion_invitation);
insert into public.token_hashes(candidate_id,token_hash,token_revision,status)
 select id,repeat('e',64),token_revision,'current' from public.token_candidates
 where target_id=(select invitation_id from completion_invitation);
-- Issuance mirrors the hash onto the invitation, and the authority resolver
-- requires the two to agree: a token that does not match the invitation it
-- names is a replaced token. The fixture forges the delivery, so it has to
-- forge this half of it too.
update public.subject_invitations set token_hash=repeat('e',64)
 where id=(select invitation_id from completion_invitation);
select is(public.respond_adult_subject_invitation_v1(repeat('e',64),'confirm',
 '76100000-0000-4000-8000-000000000001',repeat('c',64)),'accepted','the fixture uses the actual adult acceptance transition');
update completion_target set id=(select subject_id from completion_invitation),subject_revision=2,binding_revision=1;
select is(pg_temp.completion_context(),jsonb_build_object('accountRevision',2,'authSessionRevision',1,
 'jurisdictionRevision',1,'subjectBindingRevision',2,'accountBindingRevision',1,'birthDateState','adult'),
 'accepted adult context preserves distinct subject and account-binding revisions');
select lives_ok($$select pg_temp.store_nonce(repeat('f',64),'own_upload_artifact_sign')$$,
 'the accepted adult fixture holds a stored presentation for the v1 signer below');
select lives_ok($$select public.sign_own_upload_artifact_v1(
 '76100000-0000-4000-8000-000000000001','76100000-0000-4000-8000-000000000010',
 (select id from completion_target),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],2,1,1,2,1,repeat('f',64))$$,
 'an accepted adult signs with subject revision two and account-binding revision one');
delete from auth.sessions where id='76100000-0000-4000-8000-000000000010';
select throws_ok($$select pg_temp.completion_context()$$,'42501','not_found',
 'removing the originating session denies even a fresh presentation context');
select ok(not has_function_privilege(role_name,signature,'execute'),
 role_name||' cannot call '||signature) from
 unnest(array['anon','authenticated']) role_name cross join unnest(array[
 'public.own_upload_context_v1(uuid,uuid,uuid)',
 'public.complete_own_upload_account_v1(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,date,text)',
 'public.complete_own_upload_account_v2(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,date,text,timestamptz)']) signature;
select * from finish();
rollback;
