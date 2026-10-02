begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(74);
-- Synthetic SQL authority and body preservation only. Actual distinct-session
-- lock interleavings, SDK, native settings and provider checks are separate.
select is(md5(replace((select prosrc from pg_proc where
 oid='private.future_person_profile_context_v1(uuid,uuid,uuid,uuid)'::regprocedure),
 E'  perform private.future_person_profile_read_locks_v1(p_account,p_session);\n','')),
 'f88948290d39e4087ff446f258c9a7a5','the complete profile context preserves every original validation and clock position');
select is(md5(replace((select prosrc from pg_proc where
 oid='public.write_future_person_profile_v1(uuid,uuid,uuid,uuid,jsonb,uuid,bytea,bytea,jsonb,text)'::regprocedure),
 E'  perform private.future_person_profile_write_locks_v1(p_account,p_session);\n','')),
 '75243c9864bf12bd19b185b7eb1e76b0','the complete save algorithm only adds the approved write prefix');
select is(md5(replace((select prosrc from pg_proc where
 oid='public.delete_future_person_profile_v1(uuid,uuid,uuid,jsonb,text)'::regprocedure),
 E'  perform private.future_person_profile_write_locks_v1(p_account,p_session);\n','')),
 '85801650ba2c39a0b26998dc058f7339','the complete delete algorithm only adds the approved write prefix');
select is(md5(replace((select prosrc from pg_proc where
 oid='private.keyless_owner_account_v1(uuid)'::regprocedure),
 'private.assert_live_authenticated_session_write_v1();','private.assert_live_authenticated_session();')),
 '9e18878393b58d7181f2ae3f2f09dbf6','the mutating owner resolver preserves all authority and uses only the ordered strong live copy');
select is(md5(replace((select prosrc from pg_proc where
 oid='public.future_person_owner_account_objection_scope_v1(uuid)'::regprocedure),
 'private.keyless_owner_account_read_v1(p_notice);','private.keyless_owner_account_v1(p_notice);')),
 'b5d42b16687f743b5ca1740f6692f19b','the owner scope getter preserves the complete result and refusal algorithm');
select is((select prosrc from pg_proc where oid='private.future_person_profile_read_locks_v1(uuid,uuid)'::regprocedure),
 $prefix$
begin
  perform 1 from auth.users where id=p_account for share;
  perform 1 from auth.sessions where id=p_session and user_id=p_account for share;
  perform 1 from public.profiles where id=p_account for share;
end
$prefix$,'read locks are acquired separately in user/session/profile order');
select is((select prosrc from pg_proc where oid='private.future_person_profile_write_locks_v1(uuid,uuid)'::regprocedure),
 $prefix$
begin
  perform 1 from auth.users where id=p_account for share;
  perform 1 from auth.sessions where id=p_session and user_id=p_account for update;
  perform 1 from public.profiles where id=p_account for share;
end
$prefix$,'the exact write session is exclusive before entities while the profile stays compatible with both parent fingerprints');
select is((select prosrc from pg_proc where oid='private.assert_live_authenticated_session_write_v1()'::regprocedure),
 replace((select prosrc from pg_proc where oid='private.assert_live_authenticated_session()'::regprocedure),
 'where id=s and user_id=a and (not_after is null or not_after>clock_timestamp()) for share;',
 'where id=s and user_id=a and (not_after is null or not_after>clock_timestamp()) for update;'),
 'the strong live copy changes only the exact session lock after the original separate user lock and JWT checks');
select is(md5(replace(replace(replace((select prosrc from pg_proc where
 oid='private.keyless_owner_account_read_v1(uuid)'::regprocedure),
 'private.assert_live_authenticated_session_read_v1();','private.assert_live_authenticated_session();'),
 'private.validate_sensitive_account_session_read_v1(','private.validate_sensitive_account_session_v1('),
 'for share;','for update;')),
 '9e18878393b58d7181f2ae3f2f09dbf6','the separate owner read resolver preserves every original check with only shared read locks');
select is(md5(prosrc),expected_md5,'the complete existing dependent function stays unchanged: '||signature)
 from (values
 ('private.assert_live_authenticated_session()','7a8423b747e8cbca49bbb99f93f4c9be'),
 ('private.validate_sensitive_account_session_v1(uuid,uuid)','ce8813a75279262687f546121d45b4ac'),
 ('private.assert_live_authenticated_session_read_v1()','9e82a8763e4769505d09ecda9517e18f'),
 ('private.validate_sensitive_account_session_read_v1(uuid,uuid)','706dcffdb9bdd16d2efbce3126de3afc'),
 ('public.future_person_owner_objection_controls_v1(uuid)','52d4cdb44f64ac6c14eb61f74497c822'),
 ('public.future_person_profile_context_v1(uuid,uuid,uuid,uuid)','b72078a64cbb510136cbe47d2fdae787'),
 ('public.future_person_profile_controls_v1(uuid,uuid,uuid)','8ed2f87fb202d71180738418ec3c7ddd'),
 ('public.submit_future_person_account_objection_v1(uuid,bigint,text,bytea,bytea)','422651c6e50a5406cde09962d01400c4'),
 ('private.embryo_ingest_authority_fingerprint_v1(uuid)','9f68eed2744652ed9485f03f5a7f4a05'),
 ('private.resolve_embryo_basis_authority_v1(uuid)','124e882fbd33aea02a90e4bd11c596f9'),
 ('private.embryo_cohort_set_v1(uuid,text)','d9a127f51da9d3e04806cd7213f31911')
 ) expected(signature,expected_md5) join pg_proc p on p.oid=to_regprocedure(signature);
select ok(not has_function_privilege(api,door,'execute'),api||' cannot execute private authority helper '||door)
 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) api cross join unnest(array[
 'private.future_person_profile_read_locks_v1(uuid,uuid)','private.future_person_profile_write_locks_v1(uuid,uuid)',
 'private.assert_live_authenticated_session_write_v1()','private.keyless_owner_account_read_v1(uuid)']) door;
create function pg_temp.normalized_denial(p_role text,p_query text) returns jsonb
language plpgsql security invoker as $$
declare observed_role text; observed_state text:='accepted'; observed_message text;
begin
 if current_user<>'postgres' or p_role not in('anon','authenticated','inherit_upload_only','service_role') then
  raise exception using errcode='42501',message='synthetic denial probe owner only';end if;
 begin
  execute format('set local role %I',p_role);
  observed_role:=current_user;
  begin execute p_query;
  exception when others then observed_state:=sqlstate;observed_message:=sqlerrm;end;
  raise exception using errcode='ZY001',message='restore synthetic denial probe';
 exception when sqlstate 'ZY001' then null;end;
 return jsonb_build_object('role',observed_role,'state',observed_state,'message',observed_message);
end $$;
select is(pg_temp.normalized_denial(api,query),jsonb_build_object('role',api,'state','42501',
 'message',case when api='anon' then 'permission denied for schema private'
 else 'permission denied for function '||name end),api||' is actually refused at the new private boundary: '||name)
 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) api cross join (values
 ('future_person_profile_read_locks_v1','select private.future_person_profile_read_locks_v1(null,null)'),
 ('future_person_profile_write_locks_v1','select private.future_person_profile_write_locks_v1(null,null)'),
 ('assert_live_authenticated_session_write_v1','select private.assert_live_authenticated_session_write_v1()'),
 ('keyless_owner_account_read_v1','select private.keyless_owner_account_read_v1(null)')) doors(name,query);
insert into auth.users(id,email) values
 ('7a830000-0000-4000-8000-000000000001','normalization-owner@e2e.local'),
 ('7a830000-0000-4000-8000-000000000002','normalization-outsider@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) values
 ('7a830000-0000-4000-8000-000000000011','7a830000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp(),'aal1',null),
 ('7a830000-0000-4000-8000-000000000012','7a830000-0000-4000-8000-000000000002',clock_timestamp(),clock_timestamp(),'aal1',null),
 ('7a830000-0000-4000-8000-000000000013','7a830000-0000-4000-8000-000000000001',clock_timestamp()-interval '16 minutes',clock_timestamp(),'aal1',null),
 ('7a830000-0000-4000-8000-000000000014','7a830000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp(),'aal1',clock_timestamp()-interval '1 minute');
insert into private.upload_authorization_config(singleton,auth_issuer)
 values(true,'http://127.0.0.1:54321/auth/v1') on conflict(singleton) do update set auth_issuer=excluded.auth_issuer;
create function pg_temp.normalized_claims(p_override jsonb default '{}') returns void language sql as $$
 select set_config('request.jwt.claims',(jsonb_build_object('sub','7a830000-0000-4000-8000-000000000001',
  'session_id','7a830000-0000-4000-8000-000000000011','role','authenticated','aud','authenticated',
  'iss','http://127.0.0.1:54321/auth/v1','exp',floor(extract(epoch from clock_timestamp()))+600)||p_override)::text,true)::text::void;
$$;
create function pg_temp.normalized_live_probe(p_setup text,p_override jsonb default '{}') returns jsonb language plpgsql as $$
declare original jsonb; strong jsonb; read_result jsonb; result jsonb;
begin
 begin
  execute p_setup;
  perform pg_temp.normalized_claims(p_override);
  original:=private.assert_live_authenticated_session();
  strong:=private.assert_live_authenticated_session_write_v1();
  read_result:=private.assert_live_authenticated_session_read_v1();
  result:=jsonb_build_object('original',original,'strong',strong,'read',read_result);
  raise exception using errcode='ZY001',message='restore synthetic live probe';
 exception when sqlstate 'ZY001' then null;end;
 return result;
end $$;
create temporary table normalized_before as select
 (select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from auth.sessions s) sessions,
 (select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.profiles p) profiles,
 (select coalesce(jsonb_agg(to_jsonb(u) order by id),'[]') from auth.users u) users,
 (select count(*) from public.account_operation_nonces) account_nonces,
 (select count(*) from public.embryo_operation_nonces) embryo_nonces,
 (select count(*) from public.future_person_identity) identities,
 (select count(*) from public.legal_audit_log) audit;
create temporary table normalized_live_cases as select name,expected,pg_temp.normalized_live_probe(setup,override) result
 from (values
 ('current',true,'select 1','{}'::jsonb),
 ('wrong issuer',false,'select 1','{"iss":"http://wrong.e2e.local/auth/v1"}'::jsonb),
 ('wrong role',false,'select 1','{"role":"service_role"}'::jsonb),
 ('wrong audience',false,'select 1','{"aud":"other"}'::jsonb),
 ('malformed account',false,'select 1','{"sub":"malformed"}'::jsonb),
 ('malformed session',false,'select 1','{"session_id":"malformed"}'::jsonb),
 ('expired token',false,'select 1','{"exp":0}'::jsonb),
 ('nonnumeric expiry',false,'select 1','{"exp":"9999999999"}'::jsonb),
 ('borrowed session',false,'select 1','{"session_id":"7a830000-0000-4000-8000-000000000012"}'::jsonb),
 ('expired session',false,'select 1','{"session_id":"7a830000-0000-4000-8000-000000000014"}'::jsonb),
 ('missing session',false,$s$delete from auth.sessions where id='7a830000-0000-4000-8000-000000000011'$s$,'{}'::jsonb),
 ('banned user',false,$s$update auth.users set banned_until=clock_timestamp()+interval '1 day'
 where id='7a830000-0000-4000-8000-000000000001'$s$,'{}'::jsonb),
 ('deleted user',false,$s$update auth.users set deleted_at=clock_timestamp()
 where id='7a830000-0000-4000-8000-000000000001'$s$,'{}'::jsonb),
 ('account deletion hold',false,$s$update public.profiles set deletion_requested_at=clock_timestamp()
 where id='7a830000-0000-4000-8000-000000000001'$s$,'{}'::jsonb),
 ('missing profile',false,$s$delete from public.profiles where id='7a830000-0000-4000-8000-000000000001'$s$,'{}'::jsonb)
 ) cases(name,expected,setup,override);
select ok(result->'strong'=result->'original' and result->'read'=result->'original'
 and (result#>>'{strong,authorized}')::boolean=expected,
 'the complete original/read/strong authority results match exactly for '||name) from normalized_live_cases;
select pg_temp.normalized_claims();
select is(private.keyless_owner_account_read_v1(null),null::jsonb,'a current user cannot invent an owner notice through the read resolver');
select is(private.keyless_owner_account_v1(null),null::jsonb,'the strong mutating resolver also refuses a nonexistent owner notice');
set local role authenticated;
select throws_ok($$select public.future_person_owner_account_objection_scope_v1(null)$$,'42501','claim notice unavailable',
 'the actual authenticated getter retains the original opaque missing-notice refusal');
reset role;
select throws_ok($$select public.future_person_profile_context_v1('7a830000-0000-4000-8000-000000000001',
 '7a830000-0000-4000-8000-000000000011',null,null)$$,'42501','not_found',
 'a current account cannot gain an embryo context merely by completing the ordered prefix');
select throws_ok($$select public.write_future_person_profile_v1(null,null,null,null,null,null,null,null,null,null)$$,
 '22023','invalid_request','save shape validation retains its original refusal before acquiring the write prefix');
select throws_ok($$select public.delete_future_person_profile_v1('7a830000-0000-4000-8000-000000000001',
 '7a830000-0000-4000-8000-000000000011',null,null,null)$$,'42501','not_found',
 'the ordered delete prefix cannot authorize a missing subject');
select ok((select b.sessions=(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from auth.sessions s)
 and b.profiles=(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.profiles p)
 and b.users=(select coalesce(jsonb_agg(to_jsonb(u) order by id),'[]') from auth.users u)
 and b.account_nonces=(select count(*) from public.account_operation_nonces)
 and b.embryo_nonces=(select count(*) from public.embryo_operation_nonces)
 and b.identities=(select count(*) from public.future_person_identity)
 and b.audit=(select count(*) from public.legal_audit_log) from normalized_before b),
 'ordered reads and restored refusal probes change no captured Auth/profile row, nonce, identity or audit count');
select * from finish();
rollback;
