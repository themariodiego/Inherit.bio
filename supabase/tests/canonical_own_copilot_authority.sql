begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Independent bounded fixture configuration. Every change, including an
-- update to an existing local singleton, is restored by transaction rollback.
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads)
 values(true,'http://127.0.0.1:54321/auth/v1',65536,65536,262144,2)
 on conflict(singleton) do update set auth_issuer=excluded.auth_issuer,
 maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes,
 maximum_account_bytes=excluded.maximum_account_bytes,maximum_active_uploads=excluded.maximum_active_uploads;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email) values('77800000-0000-4000-8000-000000000001','copilot-settings@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('77800000-0000-4000-8000-000000000010','77800000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='77800000-0000-4000-8000-000000000001';
create temporary table copilot_subject as select id from public.subjects
 where subject_account_id='77800000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'77800000-0000-4000-8000-000000000001','77800000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('77800000-0000-4000-8000-000000000001','77800000-0000-4000-8000-000000000010',
 (select id from copilot_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('77800000-0000-4000-8000-000000000001','77800000-0000-4000-8000-000000000010',
 (select id from copilot_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));

create function pg_temp.save_model(model_name text default 'synthetic-model',class text default 'cloud') returns jsonb language sql as $$
 select public.save_own_copilot_settings_v1('77800000-0000-4000-8000-000000000001','77800000-0000-4000-8000-000000000010',
 jsonb_build_object('provider','openai_compatible','baseUrl',case when class='local' then 'http://localhost:3103/v1' else 'https://model.synthetic.invalid/v1' end,'model',model_name,
 'origin',case when class='local' then 'http://localhost:3103' else 'https://model.synthetic.invalid' end,'providerLabel','Synthetic model','providerClass',class,'runtimeAttestationFingerprint',repeat('a',64)),
 null,repeat('b',64),null);
$$;
create function pg_temp.authority(expected jsonb default null) returns jsonb language sql as $$
 select public.own_copilot_authority_v1('77800000-0000-4000-8000-000000000001','77800000-0000-4000-8000-000000000010',
 (select id from copilot_subject),expected);
$$;
create function pg_temp.presentation() returns jsonb language sql as $$
 select public.own_copilot_presentation_v1('77800000-0000-4000-8000-000000000001','77800000-0000-4000-8000-000000000010',(select id from copilot_subject));
$$;
create function pg_temp.grant_model(presentation jsonb,nonce text) returns jsonb language sql as $$
 select public.grant_own_copilot_v1('77800000-0000-4000-8000-000000000001','77800000-0000-4000-8000-000000000010',
 (select id from copilot_subject),presentation->'snapshot',presentation->'artifacts',nonce,clock_timestamp()+interval '9 minutes');
$$;
select throws_ok($$select public.save_own_copilot_settings_v1('77800000-0000-4000-8000-000000000001',
 '77800000-0000-4000-8000-000000000010',null,null,null,null)$$,'22023','invalid_request','null settings cannot authorize a configuration');
select throws_ok($$select public.save_own_copilot_settings_v1('77800000-0000-4000-8000-000000000001',
 '77800000-0000-4000-8000-000000000010','[]',null,null,null)$$,'22023','invalid_request','array settings cannot reach object validation');
select throws_ok($$select public.grant_own_copilot_v1('77800000-0000-4000-8000-000000000001',
 '77800000-0000-4000-8000-000000000010',(select id from copilot_subject),null,null,repeat('9',64),clock_timestamp()+interval '9 minutes')$$,
 '22023','invalid_request','null presentation cannot create a grant');
select throws_ok($$select public.revoke_own_copilot_v1('77800000-0000-4000-8000-000000000001',
 '77800000-0000-4000-8000-000000000010',(select id from copilot_subject),null)$$,'22023','invalid_request','revoke requires the exact expected snapshot');
select ok(pg_temp.authority() is null,'missing settings never authorize Copilot');
select is(pg_temp.save_model()->>'saved','true','actual atomic settings operation succeeds');
select ok(pg_temp.authority() is null,'saving never creates a purpose or provider grant');
select is((select count(*) from public.purpose_grants where target_id=(select id from copilot_subject)),0::bigint,'save produces zero purpose rows');
create temporary table old_presentation as select pg_temp.presentation() value;
create temporary table old_authority as select pg_temp.grant_model((select value from old_presentation),repeat('c',64)) value;
select is((select value->>'providerClass' from old_authority),'cloud','explicit permission binds cloud class');
select is((select value->>'runtimeAttestationRevision' from old_authority),'1','policy revision is numeric version one');
select is((select value->>'runtimeAttestationFingerprint' from old_authority),repeat('a',64),'actual runtime fingerprint remains separate');
select ok(pg_temp.authority((select value from old_authority)) is not null,'same exact authority rechecks');
savepoint stopped_analysis;
update public.subjects set analysis_stopped_at=clock_timestamp() where id=(select id from copilot_subject);
select ok(pg_temp.authority() is null,'permanent analysis stop also denies Copilot');
rollback to stopped_analysis;
select ok((select value->>'providerGrantId' is not null from old_authority),'cloud disclosure has a separate signed consent');
select is((select count(*) from public.purpose_grants where target_id=(select id from copilot_subject) and purpose='reports.monogenic'),0::bigint,'Copilot permission never creates report permission');
select throws_ok($$select pg_temp.grant_model((select value from old_presentation),repeat('c',64))$$,'23505',null,'single-use presentation nonce cannot replay');
select ok(pg_temp.authority(jsonb_set((select value from old_authority),'{recipientRevision}','999')) is null,'changed recipient snapshot is refused');
select ok(public.own_copilot_authority_v1('77800000-0000-4000-8000-000000000001',
 '77800000-0000-4000-8000-000000000099',(select id from copilot_subject),null) is null,'nonexistent originating session is refused');
select throws_ok($$update public.subject_consents set copilot_recipient=jsonb_set(copilot_recipient,'{revision}','999')
 where id=((select value from old_authority)->>'providerGrantId')::uuid$$,'42501','immutable_recipient','historical cloud recipient cannot be relabelled');
select is(pg_temp.save_model('changed-model')->>'saved','true','changing model is a real settings update');
select ok(pg_temp.authority() is null,'model change revokes permission before new model use');
select ok((select revoked_at is not null from public.purpose_grants where grant_id=((select value from old_authority)->>'copilotGrantId')::uuid),'prior immutable purpose is visibly revoked');
select ok((select revoked_at is not null from public.subject_consents where id=((select value from old_authority)->>'providerGrantId')::uuid),'prior cloud recipient consent is visibly revoked');
select throws_ok($$select pg_temp.grant_model((select value from old_presentation),repeat('d',64))$$,'42501','not_found','old presentation cannot grant a changed model');
create temporary table successor as select pg_temp.grant_model(pg_temp.presentation(),repeat('e',64)) value;
select isnt((select value->>'recipientRevision' from successor),(select value->>'recipientRevision' from old_authority),'successor uses a new monotonic recipient revision');
select is(public.revoke_own_copilot_v1('77800000-0000-4000-8000-000000000001','77800000-0000-4000-8000-000000000010',
 (select id from copilot_subject),(select value from successor)),true,'explicit current permission withdrawal succeeds');
select ok(pg_temp.authority() is null,'withdrawal takes effect immediately');
select is(pg_temp.save_model('local-model','local')->>'saved','true','local class is distinct in the service-only validated configuration');
create temporary table local_authority as select pg_temp.grant_model(pg_temp.presentation(),repeat('f',64)) value;
select is((select value->>'providerClass' from local_authority),'local','local purpose is explicitly selected');
select ok((select value->>'providerGrantId' is null from local_authority),'local grant does not invent cloud disclosure');
select is((select purpose from public.purpose_grants where grant_id=((select value from local_authority)->>'copilotGrantId')::uuid),'copilot.local','local purpose never substitutes for cloud');
update public.llm_settings set model='legacy-change' where user_id='77800000-0000-4000-8000-000000000001';
select ok(pg_temp.authority() is null,'legacy settings ABI invalidates canonical access');
select ok((select copilot_recipient is null from public.llm_settings where user_id='77800000-0000-4000-8000-000000000001'),'legacy write cannot mint recipient metadata');
select is(public.remove_own_copilot_settings_v1('77800000-0000-4000-8000-000000000001','77800000-0000-4000-8000-000000000010'),true,'removal uses the current session');
select is((select count(*) from public.llm_settings where user_id='77800000-0000-4000-8000-000000000001'),0::bigint,'settings removed');
select ok(not has_function_privilege('authenticated','public.grant_own_copilot_v1(uuid,uuid,uuid,jsonb,jsonb,text,timestamptz)','EXECUTE'),'browser cannot call authority writer');
select ok(not has_function_privilege('authenticated','public.own_copilot_authority_v1(uuid,uuid,uuid,jsonb)','EXECUTE'),'browser cannot invoke service authority resolver');
select ok(has_function_privilege('service_role','public.own_copilot_authority_v1(uuid,uuid,uuid,jsonb)','EXECUTE'),'server can invoke checked authority resolver');
select * from finish();
rollback;
