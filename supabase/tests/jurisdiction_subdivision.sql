-- The declared state beside the country (ADR 0032, amended 27 September 2026).
-- Entirely synthetic and rollback-only. The revocation path the writer runs on
-- a change is shared with version 1 and proven in jurisdiction_declaration.sql,
-- which reaches it through the version 1 wrapper.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
 ('79820000-0000-4000-8000-000000000001','jurisdiction-state@e2e.local',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('79820000-0000-4000-8000-000000000010','79820000-0000-4000-8000-000000000001',now(),now(),'aal1');

create function pg_temp.version() returns integer language sql as $$
 select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null; $$;
create function pg_temp.sha() returns text language sql as $$
 select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null; $$;
create function pg_temp.declare(code text,subdivision text,test boolean default false) returns jsonb language sql as $$
 select public.declare_jurisdiction_v2('79820000-0000-4000-8000-000000000001','79820000-0000-4000-8000-000000000010',
  code,subdivision,pg_temp.version(),pg_temp.sha(),test); $$;
create function pg_temp.declare_v1(code text) returns jsonb language sql as $$
 select public.declare_jurisdiction_v1('79820000-0000-4000-8000-000000000001','79820000-0000-4000-8000-000000000010',
  code,pg_temp.version(),pg_temp.sha(),false); $$;
create function pg_temp.profile() returns jsonb language sql as $$
 select jsonb_build_object('code',jurisdiction_code,'subdivision',jurisdiction_subdivision)
 from public.profiles where id='79820000-0000-4000-8000-000000000001'; $$;
create function pg_temp.declared_events() returns bigint language sql as $$
 select count(*) from public.legal_audit_log where event_code='jurisdiction.declared'; $$;

-- The attestation moved to version 2, which names the state; version 1 is kept and superseded.
select is((select count(*) from public.consent_artifacts where artifact_key='attestation.jurisdiction'
 and superseded_at is null),1::bigint,'exactly one current jurisdiction attestation');
select is(pg_temp.version(),2,'the current attestation is version 2');
select is((select superseded_at is not null and body_sha256='7cfbbe7cf54bc5e5e376bcf8f7b916ad9598826755021a56fe613bae6bea0efd'
 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and version=1),true,
 'version 1 is superseded with its signed body unchanged');
select is((select body_sha256=encode(extensions.digest(convert_to(body_markdown,'UTF8'),'sha256'),'hex')
 and body_markdown like '%If you live in the United States, you also tell Inherit which state.%'
 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and version=2),true,
 'version 2 names the state and its stored hash recomputes');
select throws_ok($$select public.declare_jurisdiction_v2('79820000-0000-4000-8000-000000000001',
 '79820000-0000-4000-8000-000000000010','GB',null,1,'7cfbbe7cf54bc5e5e376bcf8f7b916ad9598826755021a56fe613bae6bea0efd',false)$$,
 '22023','invalid_request','the superseded version 1 text is refused');

-- Only the verified server route can call the new writer.
select is(has_function_privilege('authenticated','public.declare_jurisdiction_v2(uuid,uuid,text,text,integer,text,boolean)','execute'),
 false,'a browser cannot call the version 2 writer');
select is(has_function_privilege('anon','public.declare_jurisdiction_v2(uuid,uuid,text,text,integer,text,boolean)','execute'),
 false,'anon cannot call the version 2 writer');
select is(has_function_privilege('service_role','public.declare_jurisdiction_v2(uuid,uuid,text,text,integer,text,boolean)','execute'),
 true,'the server route can call the version 2 writer');

-- The state's shape is checked by the database as well as the route.
select throws_ok($$select pg_temp.declare('GB','US-NY')$$,'22023','invalid_request','a state of another country is refused');
select throws_ok($$select pg_temp.declare('US','US-new')$$,'22023','invalid_request','a malformed state is refused');
select throws_ok($$select pg_temp.declare('US','NY')$$,'22023','invalid_request','a state without its country prefix is refused');
select throws_ok($$select pg_temp.declare('XX','XX-AA',true)$$,'22023','invalid_request','the block-only test row takes no state');
select is(pg_temp.profile(),'{"code":null,"subdivision":null}'::jsonb,'nothing was stored by any refused call');

-- A first US declaration records the state beside the country.
select is(pg_temp.declare('US','US-NY'),
 '{"jurisdiction":"US","subdivision":"US-NY","changed":true,"revokedGrants":0}'::jsonb,'a US declaration with its state');
select is(pg_temp.profile(),'{"code":"US","subdivision":"US-NY"}'::jsonb,'the profile holds US and US-NY');
select is((select coded_context->>'subdivision' from public.legal_audit_log where event_code='jurisdiction.declared'
 order by seq desc limit 1),'US-NY','the audit event records the state');

-- Moving state is a change, like moving country; re-saving the same answer is not.
select is((pg_temp.declare('US','US-TX')->>'changed')::boolean,true,'a changed state is a changed declaration');
select is(pg_temp.profile(),'{"code":"US","subdivision":"US-TX"}'::jsonb,'the new state is stored');
select is((pg_temp.declare('US','US-TX')->>'changed')::boolean,false,'the same state again changes nothing');

-- Version 1, kept for the build that is live when this is applied, keeps its exact result shape.
select is(pg_temp.declare_v1('US'),'{"jurisdiction":"US","changed":false,"revokedGrants":0}'::jsonb,
 'version 1 on the same country keeps the recorded state and returns only its own three keys');
select is(pg_temp.profile(),'{"code":"US","subdivision":"US-TX"}'::jsonb,'the state survives a version 1 re-save');
select is((pg_temp.declare_v1('FR')->>'changed')::boolean,true,'version 1 still records a changed country');
select is(pg_temp.profile(),'{"code":"FR","subdivision":null}'::jsonb,'a different country clears the old state');

-- The table itself refuses a state that does not belong to the declared country.
select throws_ok($$update public.profiles set jurisdiction_subdivision='US-NY'
 where id='79820000-0000-4000-8000-000000000001'$$,'23514',null,'a US state cannot sit beside FR');
select throws_ok($$update public.profiles set jurisdiction_code=null,jurisdiction_declared_at=null,
 jurisdiction_attestation_version=null,jurisdiction_attestation_sha256=null,jurisdiction_subdivision='US-NY'
 where id='79820000-0000-4000-8000-000000000001'$$,'23514',null,'a state cannot exist without a country');

-- D-135 extends to the state: a signed-in browser cannot write it around the writer.
do $$ begin perform set_config('request.jwt.claims',
 '{"sub":"79820000-0000-4000-8000-000000000001","session_id":"79820000-0000-4000-8000-000000000010","role":"authenticated"}',
 true); end $$;
select pg_temp.declare('US','US-CA');
set local role authenticated;
select throws_ok($$update public.profiles set jurisdiction_subdivision='US-NY' where id='79820000-0000-4000-8000-000000000001'$$,
 '42501','jurisdiction_server_only','a signed-in browser cannot change its own state around the writer');
reset role;
select is(pg_temp.profile(),'{"code":"US","subdivision":"US-CA"}'::jsonb,'the state is the one the writer stored');

select * from finish();
rollback;
