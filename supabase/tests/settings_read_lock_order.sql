begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic metadata exercises SQL authorization. This gives no SDK/Auth,
-- native browser, notice delivery, or physical-provider evidence.
insert into auth.users(id,email) values
 ('7a820000-0000-4000-8000-000000000001','settings-owner@e2e.local'),
 ('7a820000-0000-4000-8000-000000000002','settings-outsider@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) values
 ('7a820000-0000-4000-8000-000000000011','7a820000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp(),'aal1',null),
 ('7a820000-0000-4000-8000-000000000012','7a820000-0000-4000-8000-000000000002',clock_timestamp(),clock_timestamp(),'aal1',null),
 ('7a820000-0000-4000-8000-000000000013','7a820000-0000-4000-8000-000000000001',clock_timestamp()-interval '16 minutes',clock_timestamp(),'aal1',null),
 ('7a820000-0000-4000-8000-000000000014','7a820000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp(),'aal1',clock_timestamp()-interval '1 minute');
insert into private.upload_authorization_config(singleton,auth_issuer)
 values(true,'http://127.0.0.1:54321/auth/v1') on conflict(singleton) do update set auth_issuer=excluded.auth_issuer;
create function pg_temp.settings_claims(p_override jsonb default '{}') returns void language sql as $$
 select set_config('request.jwt.claims',(jsonb_build_object('sub','7a820000-0000-4000-8000-000000000001',
  'session_id','7a820000-0000-4000-8000-000000000011','role','authenticated','aud','authenticated',
  'iss','http://127.0.0.1:54321/auth/v1','exp',floor(extract(epoch from clock_timestamp()))+600)||p_override)::text,true)::text::void;
$$;
create function pg_temp.settings_probe(p_setup text,p_override jsonb default '{}') returns text language plpgsql as $$
declare answer text;
begin
 begin
  execute p_setup;
  perform pg_temp.settings_claims(p_override);
  execute 'set local role authenticated';
  perform public.future_person_owner_objection_controls_v1(null);
  execute 'reset role';
  answer:='accepted';
  raise exception using errcode='ZY001',message='restore synthetic settings probe';
 exception when sqlstate 'ZY001' then null;
  when others then answer:=sqlstate||':'||sqlerrm;
 end;
 return answer;
end $$;
select is((select prosrc from pg_proc where oid='private.assert_live_authenticated_session_read_v1()'::regprocedure),
 replace((select prosrc from pg_proc where oid='private.assert_live_authenticated_session()'::regprocedure),
 'from public.profiles where id=a for update;','from public.profiles where id=a for share;'),
 'the complete live validator retains every security check and changes only the profile read lock');
select is((select prosrc from pg_proc where oid='private.validate_sensitive_account_session_read_v1(uuid,uuid)'::regprocedure),
 replace((select prosrc from pg_proc where oid='private.validate_sensitive_account_session_v1(uuid,uuid)'::regprocedure),
 'for update;','for share;'),
 'the complete sensitive validator retains the exact reauthentication and MFA algorithm');
select ok(not has_function_privilege(r,f,'execute'),format('%s cannot call private read validator %s',r,f))
 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r
 cross join unnest(array['private.assert_live_authenticated_session_read_v1()',
 'private.validate_sensitive_account_session_read_v1(uuid,uuid)']) f;
select ok(has_function_privilege('authenticated','public.future_person_owner_objection_controls_v1(uuid)','execute'),
 'only the genuine authenticated public inventory retains its original entry');
select ok(not has_function_privilege(r,'public.future_person_owner_objection_controls_v1(uuid)','execute'),
 format('%s cannot enumerate owner notices',r)) from unnest(array['anon','inherit_upload_only','service_role']) r;
create temporary table settings_before as select
 (select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from auth.sessions s) sessions,
 (select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.profiles p) profiles,
 (select count(*) from public.account_operation_nonces) nonces,
 (select count(*) from public.embryo_operation_nonces) embryo_nonces,
 (select count(*) from public.future_person_identity) identities,
 (select count(*) from public.legal_audit_log) audit;
select pg_temp.settings_claims();
set local role authenticated;
select is(public.future_person_owner_objection_controls_v1(null),'{"items":[],"nextCursor":null}'::jsonb,
 'the actual authenticated current account can read its empty owner inventory');
reset role;
select is(pg_temp.settings_probe('select 1'), 'accepted','a repeated read accepts the same current live authority');
select is(pg_temp.settings_probe('select 1','{"iss":"http://wrong.e2e.local/auth/v1"}'),
 '42501:claim notice unavailable','a different issuer is refused');
select is(pg_temp.settings_probe('select 1','{"role":"service_role"}'),
 '42501:claim notice unavailable','a borrowed token role is refused');
select is(pg_temp.settings_probe('select 1','{"aud":"other"}'),
 '42501:claim notice unavailable','a different token audience is refused');
select is(pg_temp.settings_probe('select 1','{"sub":"malformed"}'),
 '42501:claim notice unavailable','malformed account metadata is refused');
select is(pg_temp.settings_probe('select 1','{"session_id":"malformed"}'),
 '42501:claim notice unavailable','malformed session metadata is refused');
select is(pg_temp.settings_probe('select 1','{"exp":0}'),
 '42501:claim notice unavailable','an expired token is refused');
select is(pg_temp.settings_probe('select 1','{"exp":"9999999999"}'),
 '42501:claim notice unavailable','a nonnumeric token expiry is refused');
select is(pg_temp.settings_probe('select 1','{"session_id":"7a820000-0000-4000-8000-000000000012"}'),
 '42501:claim notice unavailable','an account cannot borrow another account session');
select is(pg_temp.settings_probe('select 1','{"session_id":"7a820000-0000-4000-8000-000000000013"}'),
 '42501:recent_reauthentication_required','an old live session still requires recent reauthentication');
select is(pg_temp.settings_probe('select 1','{"session_id":"7a820000-0000-4000-8000-000000000014"}'),
 '42501:claim notice unavailable','an expired stored session is refused');
select is(pg_temp.settings_probe($p$delete from auth.sessions where id='7a820000-0000-4000-8000-000000000011'$p$),
 '42501:claim notice unavailable','a removed stored session is refused');
select is(pg_temp.settings_probe($p$update auth.users set banned_until=clock_timestamp()+interval '1 day'
 where id='7a820000-0000-4000-8000-000000000001'$p$),'42501:claim notice unavailable','a banned account is refused');
select is(pg_temp.settings_probe($p$update auth.users set deleted_at=clock_timestamp()
 where id='7a820000-0000-4000-8000-000000000001'$p$),'42501:claim notice unavailable','a deleted account is refused');
select is(pg_temp.settings_probe($p$update public.profiles set deletion_requested_at=clock_timestamp()
 where id='7a820000-0000-4000-8000-000000000001'$p$),'42501:claim notice unavailable','an account under deletion hold is refused');
select is(pg_temp.settings_probe($p$delete from public.profiles where id='7a820000-0000-4000-8000-000000000001'$p$),
 '42501:claim notice unavailable','an absent account profile is refused');
select is(pg_temp.settings_probe($p$insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
 values('7a820000-0000-4000-8000-000000000021','7a820000-0000-4000-8000-000000000001',
 'Synthetic settings factor','totp','verified','synthetic-settings-factor',clock_timestamp(),clock_timestamp())$p$),
 '42501:mfa_required','a configured factor still refuses an aal1 session');
select is(pg_temp.settings_probe($p$insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
 values('7a820000-0000-4000-8000-000000000021','7a820000-0000-4000-8000-000000000001',
 'Synthetic settings factor','totp','verified','synthetic-settings-factor',clock_timestamp(),clock_timestamp());
 update auth.sessions set aal='aal2' where id='7a820000-0000-4000-8000-000000000011'$p$),
 'accepted','the same verified factor accepts a genuine current aal2 session');
select ok((select b.sessions=(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from auth.sessions s)
 and b.profiles=(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.profiles p)
 and b.nonces=(select count(*) from public.account_operation_nonces)
 and b.embryo_nonces=(select count(*) from public.embryo_operation_nonces)
 and b.identities=(select count(*) from public.future_person_identity)
 and b.audit=(select count(*) from public.legal_audit_log) from settings_before b),
 'inventories and restored refusal probes leave every captured session/profile and durable-operation count unchanged');
select * from finish();
rollback;
