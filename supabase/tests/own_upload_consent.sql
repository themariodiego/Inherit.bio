begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
 ('76000000-0000-4000-8000-000000000001','own-consent@example.invalid','{"display_name":"Own consent"}'),
 ('76000000-0000-4000-8000-000000000002','foreign-consent@example.invalid','{"display_name":"Foreign consent"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('76000000-0000-4000-8000-000000000010','76000000-0000-4000-8000-000000000001',now()-interval '1 hour',now(),'aal1');
create temporary table own_consent_target as select id from public.subjects
 where subject_account_id='76000000-0000-4000-8000-000000000001' and subject_class='self';
-- Explicitly model the historical migrated grant; new test accounts need not
-- have participated in the old one-time backfill.
insert into public.consent_signatures(artifact_key,artifact_version,artifact_body_sha256,
 signer_principal_id,signer_account_id,target_kind,target_id,purpose,statement_keys,
 jurisdiction_code,jurisdiction_revision,subject_binding_revision)
select ca.artifact_key,ca.version,ca.body_sha256,sp.id,sp.account_id,'subject',sp.subject_id,
 'self-source-migrated',array['self-upload-authorization'],'ZZ',1,1
from public.subject_principals sp cross join public.consent_artifacts ca
where sp.subject_id=(select id from own_consent_target) and sp.principal_kind='account_subject'
 and ca.artifact_key='consent.self-source-migrated' and ca.version=1
 and not exists(select 1 from public.consent_signatures cs where cs.target_id=sp.subject_id
   and cs.artifact_key=ca.artifact_key);
insert into public.subject_consents(signature_id,subject_id,account_id,consent_type,scope)
select cs.id,cs.target_id,cs.signer_account_id,'self_source',array['variants','reports.monogenic','ancestry']
from public.consent_signatures cs where cs.target_id=(select id from own_consent_target)
 and cs.artifact_key='consent.self-source-migrated'
 and not exists(select 1 from public.subject_consents sc where sc.subject_id=cs.target_id
   and sc.consent_type='self_source' and sc.revoked_at is null);
create temporary table historical_consent as select to_jsonb(c) row from public.subject_consents c
 where subject_id=(select id from own_consent_target);
select is((select count(*) from historical_consent),1::bigint,'the history-preservation fixture is nonempty');
grant select on own_consent_target to service_role;
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
select repeat(letter,64),'76000000-0000-4000-8000-000000000001',
 '76000000-0000-4000-8000-000000000010','own_upload_artifact_sign',clock_timestamp()+interval '10 minutes'
from unnest(array['a','b','c','d','e']) letter;
create function pg_temp.sign_own(p_key text,p_nonce text,p_rev bigint default 1,p_hash text default null,p_keys text[] default null)
returns jsonb language sql as $$
 select public.sign_own_upload_artifact_v1(
 '76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000010',
 (select id from own_consent_target),p_key,1,
 coalesce(p_hash,(select body_sha256 from public.consent_artifacts where artifact_key=p_key and version=1)),
 coalesce(p_keys,case p_key when 'consent.upload-self' then array['own-adult-dna'] else array['understood'] end),
 p_rev,1,1,1,repeat(p_nonce,64));
$$;
select throws_ok($$select pg_temp.sign_own('disclosure.insurance-and-discrimination','a')$$,
 '55000','adult_account_required','missing birth date cannot be replaced with a checkbox assertion');
update public.profiles set date_of_birth=(current_date-interval '17 years')::date
 where id='76000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.sign_own('disclosure.insurance-and-discrimination','a')$$,
 '55000','adult_account_required','an underage account cannot sign');
update public.profiles set date_of_birth=date '1990-01-01'
 where id='76000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"76000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$update public.profiles set date_of_birth=date '1980-01-01'
 where id='76000000-0000-4000-8000-000000000001'$$,
 '42501','birth_date_server_only','table-level profile grants cannot bypass age declaration validation');
select lives_ok($$update public.profiles set display_name='Own consent updated'
 where id='76000000-0000-4000-8000-000000000001'$$,
 'ordinary profile editing is preserved');
reset role;
select throws_ok($$select pg_temp.sign_own('consent.upload-self','b')$$,
 '55000','insurance_acknowledgement_required','the class checkbox cannot imply insurance acknowledgement');
select throws_ok($$select pg_temp.sign_own('disclosure.insurance-and-discrimination','a',2)$$,
 '42501','not_found','a stale account revision fails');
select throws_ok($$select pg_temp.sign_own('disclosure.insurance-and-discrimination','a',1,repeat('f',64))$$,
 '55000','consent_artifact_changed','a changed artifact hash cannot be signed unseen');
select throws_ok($$select pg_temp.sign_own('disclosure.insurance-and-discrimination','a',1,null,array['understood','sharing'])$$,
 '22023','invalid_request','an extra statement is not silently accepted');
select is((select count(*) from public.consent_signatures where target_id=(select id from own_consent_target)
 and artifact_key in ('consent.upload-self','disclosure.insurance-and-discrimination')),0::bigint,
 'all refused attempts have zero new signatures');
select is((select count(*) from public.account_operation_nonces
 where account_id='76000000-0000-4000-8000-000000000001' and consumed_at is not null),0::bigint,
 'refused attempts leave valid presentations usable');
set local role service_role;
select lives_ok($$select pg_temp.sign_own('disclosure.insurance-and-discrimination','a')$$,
 'a live hour-old session can record the explicit disclosure without forced re-login');
reset role;
select lives_ok($$select pg_temp.sign_own('consent.upload-self','b')$$,'the own-DNA confirmation records after disclosure');
select throws_ok($$select pg_temp.sign_own('consent.upload-self','b')$$,'42501','not_found','a consumed presentation cannot replay');
select is((select scope from public.subject_consents where subject_id=(select id from own_consent_target)
 and consent_type='upload_class' and revoked_at is null),array['store'],'class consent grants storage only');
select is((select count(*) from public.purpose_grants where target_id=(select id from own_consent_target)),0::bigint,
 'class consent does not create an analytic or sharing grant');
select is((select count(*) from public.genome_files where subject_id=(select id from own_consent_target)),0::bigint,
 'recording consent does not upload a genome');
select ok(not exists(select row from historical_consent except select to_jsonb(c) from public.subject_consents c),
 'historical self-source authorizations remain byte-for-byte unchanged');
select lives_ok($$select pg_temp.sign_own('consent.upload-self','c')$$,'a fresh explicit confirmation can replace only the class grant');
select is((select count(*) from public.subject_consents where subject_id=(select id from own_consent_target)
 and consent_type='upload_class' and revoked_at is null),1::bigint,'only one class grant remains current');
select is((select count(*) from public.subject_consents where subject_id=(select id from own_consent_target)
 and consent_type='upload_class' and revocation_reason='superseded'),1::bigint,'the earlier class signature stays in history');
update public.profiles set deletion_requested_at=clock_timestamp()
 where id='76000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.sign_own('consent.upload-self','d')$$,'42501','not_found','a deletion hold refuses new consent');
update public.profiles set deletion_requested_at=null,auth_session_revision=2
 where id='76000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.sign_own('consent.upload-self','d')$$,'42501','not_found','revoked account session authority refuses a stale presentation');
update public.profiles set auth_session_revision=1 where id='76000000-0000-4000-8000-000000000001';
update public.subjects set subject_binding_revision=2 where id=(select id from own_consent_target);
select throws_ok($$select pg_temp.sign_own('consent.upload-self','d')$$,'42501','not_found','a changed subject binding refuses a stale presentation');
update public.subjects set subject_binding_revision=1 where id=(select id from own_consent_target);
update own_consent_target set id=(select id from public.subjects
 where subject_account_id='76000000-0000-4000-8000-000000000002' and subject_class='self');
select throws_ok($$select pg_temp.sign_own('consent.upload-self','d')$$,'42501','not_found',
 'the same service route cannot sign for another account subject');
update own_consent_target set id=(select id from public.subjects
 where subject_account_id='76000000-0000-4000-8000-000000000001' and subject_class='self');
update public.account_operation_nonces set issued_at=clock_timestamp()-interval '20 minutes',
 expires_at=clock_timestamp()-interval '10 minutes' where nonce_hash=repeat('d',64);
select throws_ok($$select pg_temp.sign_own('consent.upload-self','d')$$,'42501','not_found','an expired presentation is refused');
update public.account_operation_nonces set issued_at=clock_timestamp(),expires_at=clock_timestamp()+interval '10 minutes'
 where nonce_hash=repeat('d',64);
delete from auth.sessions where id='76000000-0000-4000-8000-000000000010';
select throws_ok($$select pg_temp.sign_own('consent.upload-self','d')$$,'42501','not_found','removing the originating session immediately refuses the presentation');
select ok(not has_function_privilege('authenticated',
 'public.sign_own_upload_artifact_v1(uuid,uuid,uuid,text,integer,text,text[],bigint,bigint,bigint,bigint,text)','execute'),
 'authenticated clients cannot bypass the signed route');
select ok(not has_function_privilege('anon',
 'private.sign_own_upload_artifact_v1(uuid,uuid,uuid,text,integer,text,text[],bigint,bigint,bigint,bigint,text)','execute'),
 'the private implementation is not public');
select ok(not (select prosecdef from pg_proc where oid=
 'public.sign_own_upload_artifact_v1(uuid,uuid,uuid,text,integer,text,text[],bigint,bigint,bigint,bigint,text)'::regprocedure),
 'the public wrapper is SECURITY INVOKER');
select * from finish();
rollback;
