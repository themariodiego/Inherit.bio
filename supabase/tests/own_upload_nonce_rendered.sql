begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Brief X1.5 for the upload page: its consent and account-completion tokens
-- are rendered and stored nowhere; the POST records the nonce hash once, in
-- the same transaction as the signature or the completion.

select is(to_regprocedure('public.issue_own_upload_nonce_v1(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,text,text,timestamptz)'),null,
 'the public nonce-issuing door is gone');
select is(to_regprocedure('private.issue_own_upload_nonce_v1(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,text,text,timestamptz)'),null,
 'and so is its private body');
select ok(not has_function_privilege('service_role','public.sign_own_upload_artifact_v1(uuid,uuid,uuid,text,integer,text,text[],bigint,bigint,bigint,bigint,bigint,text)','EXECUTE')
 and not has_function_privilege('service_role','private.sign_own_upload_artifact_v1(uuid,uuid,uuid,text,integer,text,text[],bigint,bigint,bigint,bigint,bigint,text)','EXECUTE'),
 'the service role cannot reach the v1 signer, which consumes only a stored nonce');
select ok(not has_function_privilege('service_role','public.complete_own_upload_account_v1(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,date,text)','EXECUTE')
 and not has_function_privilege('service_role','private.complete_own_upload_account_v1(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,date,text)','EXECUTE'),
 'nor the v1 completion');
select ok(has_function_privilege('service_role','public.sign_own_upload_artifact_v2(uuid,uuid,uuid,text,integer,text,text[],bigint,bigint,bigint,bigint,bigint,text,timestamp with time zone)','EXECUTE')
 and has_function_privilege('service_role','public.complete_own_upload_account_v2(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,date,text,timestamp with time zone)','EXECUTE'),
 'the service role signs and completes through v2');
select ok(not has_function_privilege('authenticated','public.sign_own_upload_artifact_v2(uuid,uuid,uuid,text,integer,text,text[],bigint,bigint,bigint,bigint,bigint,text,timestamp with time zone)','EXECUTE')
 and not has_function_privilege('authenticated','private.complete_own_upload_account_v2(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,date,text,timestamp with time zone)','EXECUTE'),
 'a signed-in user can reach neither v2 door nor body');
select ok(not has_function_privilege('service_role','private.record_own_upload_nonce_v1(uuid,uuid,text,text,timestamp with time zone)','EXECUTE'),
 'the nonce recorder is reachable only through v2');
select is((select string_agg(n.nspname||':'||p.prosecdef,',' order by n.nspname) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where p.proname='sign_own_upload_artifact_v2'),'private:true,public:false',
 'the public door is an invoker over a private definer body');

insert into auth.users(id,email,raw_user_meta_data) values
 ('7a400000-0000-4000-8000-000000000001','own-nonce-rendered@e2e.local','{"display_name":"Rendered nonce"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('7a400000-0000-4000-8000-000000000010','7a400000-0000-4000-8000-000000000001',now(),now(),'aal1');
create temporary table target as select id from public.subjects
 where subject_account_id='7a400000-0000-4000-8000-000000000001' and subject_class='self';
grant select on target to service_role;
create function pg_temp.complete(p_date date,p_nonce text,p_expiry timestamptz default clock_timestamp()+interval '9 minutes')
 returns jsonb language sql as $$
 select public.complete_own_upload_account_v2('7a400000-0000-4000-8000-000000000001',
 '7a400000-0000-4000-8000-000000000010',(select id from target),1,1,1,1,1,p_date,p_nonce,p_expiry);
$$;
create function pg_temp.sign(p_key text,p_nonce text,p_expiry timestamptz default clock_timestamp()+interval '9 minutes')
 returns jsonb language sql as $$
 select public.sign_own_upload_artifact_v2('7a400000-0000-4000-8000-000000000001',
 '7a400000-0000-4000-8000-000000000010',(select id from target),p_key,1,
 (select body_sha256 from public.consent_artifacts where artifact_key=p_key and version=1),
 case when p_key='consent.upload-self' then array['own-adult-dna'] else array['understood'] end,2,1,1,1,1,p_nonce,p_expiry);
$$;
create function pg_temp.stored() returns bigint language sql as $$
 select count(*) from public.account_operation_nonces where account_id='7a400000-0000-4000-8000-000000000001';
$$;

select is(pg_temp.stored(),0::bigint,'nothing is stored before an operation');

set local role service_role;
-- The recorder's own bounds, the ceiling issue_own_upload_nonce_v1 enforced.
select throws_ok($$select pg_temp.complete(date '1990-01-01',repeat('1',64),clock_timestamp()+interval '11 minutes')$$,
 '42501','not_found','a token that claims to live more than ten minutes is refused');
select throws_ok($$select pg_temp.complete(date '1990-01-01',repeat('1',64),clock_timestamp()-interval '1 second')$$,
 '42501','not_found','an expired token is refused');
select throws_ok($$select pg_temp.complete(date '1990-01-01','short')$$,
 '42501','not_found','a nonce digest must have the exact shape');
-- The v1 body still decides everything else, and a refusal spends nothing.
select throws_ok($$select pg_temp.complete((timezone('UTC',clock_timestamp())::date-interval '18 years')::date+1,repeat('1',64))$$,
 '22023','adult_account_required','the v1 body still refuses an underage date');
select throws_ok($$select pg_temp.sign('disclosure.insurance-and-discrimination',repeat('1',64))$$,
 '42501','not_found','signing before completion is refused by the v1 body');
reset role;
select is(pg_temp.stored(),0::bigint,'every refused attempt recorded nothing');

set local role service_role;
select is(pg_temp.complete(date '1990-01-01',repeat('1',64)),'{"status":"completed"}'::jsonb,
 'a rendered completion token completes through v2');
reset role;
select is((select count(*) from public.account_operation_nonces where nonce_hash=repeat('1',64)
 and operation='own_account_completion' and consumed_at is not null),1::bigint,'the completion recorded its nonce once, already spent');

set local role service_role;
select is(pg_temp.sign('disclosure.insurance-and-discrimination',repeat('2',64))->>'artifactKey',
 'disclosure.insurance-and-discrimination','a rendered consent token signs through v2');
select throws_ok($$select pg_temp.sign('consent.upload-self',repeat('2',64))$$,
 '42501','not_found','a spent nonce cannot be replayed, even for the next artifact');
select throws_ok($$select pg_temp.sign('consent.upload-self',repeat('1',64))$$,
 '42501','not_found','nor can the completion nonce stand in for a signature');
select is(pg_temp.sign('consent.upload-self',repeat('3',64))->>'artifactKey','consent.upload-self',
 'a fresh token signs the next artifact');
reset role;
select is((select count(*) from public.subject_consents where subject_id=(select id from target) and revoked_at is null
 and consent_type='upload_class'),1::bigint,'the signed consent is live');

-- A spent hash lives until its token would have expired, then goes.
update public.account_operation_nonces set issued_at=clock_timestamp()-interval '12 minutes',
 expires_at=clock_timestamp()-interval '2 minutes' where nonce_hash=repeat('1',64);
set local role service_role;
select lives_ok($$select pg_temp.sign('disclosure.insurance-and-discrimination',repeat('5',64))$$,
 'a later successful operation');
reset role;
select is((select count(*) from public.account_operation_nonces where nonce_hash=repeat('1',64)),0::bigint,
 'prunes the expired spent hash');
select is((select count(*) from public.account_operation_nonces where nonce_hash in (repeat('2',64),repeat('3',64),repeat('5',64))),
 3::bigint,'and keeps the unexpired ones');

select * from finish();
rollback;
