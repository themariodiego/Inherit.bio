begin;
select no_plan();
-- The disclosure reads deployment capacity and one account's own reserved
-- total. It must agree with the issuer it quotes, and must never widen who
-- can read that capacity or whose bytes are counted.

insert into private.upload_authorization_config(singleton,auth_issuer)
 values(true,'http://127.0.0.1:54321/auth/v1')
 on conflict(singleton) do update set auth_issuer=excluded.auth_issuer;
update private.upload_authorization_config set maximum_array_bytes=52428800,maximum_vcf_bytes=25165824,
 maximum_account_bytes=134217728,maximum_active_uploads=2 where singleton;
insert into auth.users(id,email,raw_user_meta_data) values
 ('76400000-0000-4000-8000-000000000001','limit-disclosure@e2e.local','{"display_name":"Synthetic uploader"}'),
 ('76400000-0000-4000-8000-000000000002','limit-neighbour@e2e.local','{"display_name":"Synthetic neighbour"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('76400000-0000-4000-8000-000000000010','76400000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('76400000-0000-4000-8000-000000000011','76400000-0000-4000-8000-000000000002',now(),now(),'aal1');
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) values
 ('76400000-0000-4000-8000-000000000012','76400000-0000-4000-8000-000000000001',now(),now(),'aal1',
  clock_timestamp()-interval '1 minute');
update public.profiles set date_of_birth=date '1990-01-01'
 where id in('76400000-0000-4000-8000-000000000001','76400000-0000-4000-8000-000000000002');
create temporary table upload_role_subject as select id from public.subjects
 where subject_account_id='76400000-0000-4000-8000-000000000001' and subject_class='self';
create function pg_temp.limits() returns jsonb language sql as $$
 select public.own_upload_limits_v1('76400000-0000-4000-8000-000000000001',
  '76400000-0000-4000-8000-000000000010');
$$;

select is(pg_temp.limits(),jsonb_build_object('maximumArrayBytes',52428800,'maximumVcfBytes',25165824,
 'maximumAccountBytes',134217728,'maximumActiveUploads',2,'reservedBytes',0,'activeUploads',0),
 'an empty account is disclosed the exact deployment ceilings and no reservation');

select throws_ok($$select public.own_upload_limits_v1(null,'76400000-0000-4000-8000-000000000010')$$,
 '42501','not_found','a missing account is refused');
select throws_ok($$select public.own_upload_limits_v1('76400000-0000-4000-8000-000000000001',null)$$,
 '42501','not_found','a missing session is refused');
select throws_ok($$select public.own_upload_limits_v1('76400000-0000-4000-8000-000000000001',
 '76400000-0000-4000-8000-000000000011')$$,'42501','not_found',
 'another account''s live session cannot read these bytes');
select throws_ok($$select public.own_upload_limits_v1('76400000-0000-4000-8000-000000000002',
 '76400000-0000-4000-8000-000000000010')$$,'42501','not_found',
 'a session belonging to a different account is refused');
select throws_ok($$select public.own_upload_limits_v1('76400000-0000-4000-8000-000000000001',
 '76400000-0000-4000-8000-000000000012')$$,'42501','not_found','an expired session is refused');

update private.upload_authorization_config set maximum_vcf_bytes=null where singleton;
select throws_ok($$select pg_temp.limits()$$,'55000','upload_unavailable',
 'incomplete deployment capacity discloses no partial ceiling');
update private.upload_authorization_config set maximum_vcf_bytes=25165824 where singleton;

-- The disclosed remainder must move with the same reservation the issuer
-- applies, including a pending upload that has committed no file yet.
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'76400000-0000-4000-8000-000000000001',
 '76400000-0000-4000-8000-000000000010','own_upload_artifact_sign',clock_timestamp()+interval '9 minutes'
 from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('76400000-0000-4000-8000-000000000001',
 '76400000-0000-4000-8000-000000000010',(select id from upload_role_subject),
 'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('76400000-0000-4000-8000-000000000001',
 '76400000-0000-4000-8000-000000000010',(select id from upload_role_subject),
 'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
select public.issue_own_storage_upload_v1('76400000-0000-4000-8000-000000000001',
 '76400000-0000-4000-8000-000000000010',(select id from upload_role_subject),'VCF',1000,repeat('a',64));

select is(pg_temp.limits()->'reservedBytes',to_jsonb(1000),
 'a pending upload reserves its declared bytes in the disclosed total');
select is(pg_temp.limits()->'activeUploads',to_jsonb(1),'a pending upload counts against the disclosed lease count');

-- The exact boundary the disclosure implies is the boundary issuance enforces.
update private.upload_authorization_config set maximum_account_bytes=1500 where singleton;
select lives_ok($$select public.issue_own_storage_upload_v1('76400000-0000-4000-8000-000000000001',
 '76400000-0000-4000-8000-000000000010',(select id from upload_role_subject),'VCF',500,repeat('b',64))$$,
 'the disclosed remainder is issuable');
select is(pg_temp.limits()->'reservedBytes',to_jsonb(1500),'the second pending upload exhausts the disclosed remainder');
select throws_ok($$select public.issue_own_storage_upload_v1('76400000-0000-4000-8000-000000000001',
 '76400000-0000-4000-8000-000000000010',(select id from upload_role_subject),'VCF',1,repeat('c',64))$$,
 '22023','file_too_large','one byte beyond the disclosed remainder is refused');
update private.upload_authorization_config set maximum_account_bytes=134217728 where singleton;

select ok(has_function_privilege('service_role','public.own_upload_limits_v1(uuid,uuid)','execute'),
 'the server role may read the disclosure');
select ok(not has_function_privilege('authenticated','public.own_upload_limits_v1(uuid,uuid)','execute')
 and not has_function_privilege('anon','public.own_upload_limits_v1(uuid,uuid)','execute')
 and not has_function_privilege('inherit_upload_only','public.own_upload_limits_v1(uuid,uuid)','execute'),
 'no browser or upload role may read deployment capacity directly');
select ok(not has_function_privilege('authenticated','private.own_upload_limits_v1(uuid,uuid)','execute')
 and not has_function_privilege('anon','private.own_upload_limits_v1(uuid,uuid)','execute')
 and not has_function_privilege('inherit_upload_only','private.own_upload_limits_v1(uuid,uuid)','execute'),
 'the private definer stays unreachable from browser and upload roles');
select is((select count(*) from public.genome_files where user_id='76400000-0000-4000-8000-000000000001'),0::bigint,
 'reading the disclosure commits no file');

select * from finish();
rollback;
