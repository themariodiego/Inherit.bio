begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(17);
-- Synthetic identities only. Every fixture and probe rolls back.
insert into auth.users(id,email) values
 ('7a810000-0000-4000-8000-000000000001','embryo-stage-owner@e2e.local'),
 ('7a810000-0000-4000-8000-000000000002','embryo-stage-outsider@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) values
 ('7a810000-0000-4000-8000-000000000011','7a810000-0000-4000-8000-000000000001',now(),now(),'aal1',null),
 ('7a810000-0000-4000-8000-000000000012','7a810000-0000-4000-8000-000000000002',now(),now(),'aal1',null),
 ('7a810000-0000-4000-8000-000000000013','7a810000-0000-4000-8000-000000000001',now()-interval '16 minutes',now(),'aal1',null),
 ('7a810000-0000-4000-8000-000000000014','7a810000-0000-4000-8000-000000000001',now(),now(),'aal1',now()-interval '1 minute');
create function pg_temp.live() returns boolean language sql as $$
 select public.embryo_upload_account_live_v1('7a810000-0000-4000-8000-000000000001','7a810000-0000-4000-8000-000000000011')
$$;
create function pg_temp.probe(p_setup text) returns boolean language plpgsql as $$
declare answer boolean;
begin
 begin
  execute p_setup;
  answer:=pg_temp.live();
  raise exception using errcode='ZY001',message='restore synthetic probe';
 exception when sqlstate 'ZY001' then null;
 end;
 return answer;
end $$;
create temporary table before_read as select
 (select count(*) from public.account_operation_nonces) nonces,
 (select count(*) from public.embryo_operation_nonces) embryo_nonces,
 (select count(*) from public.legal_audit_log) audit;
select ok(has_function_privilege('service_role','public.embryo_upload_account_live_v1(uuid,uuid)','execute'),
 'the verified server can ask for its current stage authority');
select ok(not has_function_privilege(r,'public.embryo_upload_account_live_v1(uuid,uuid)','execute'),
 format('%s cannot inspect an account or auth session through this door',r))
 from unnest(array['anon','authenticated','inherit_upload_only']) r;
select is(pg_temp.live(),true,'a current exact account/session is accepted');
select is(public.embryo_upload_account_live_v1('7a810000-0000-4000-8000-000000000001',
 '7a810000-0000-4000-8000-000000000012'),false,'another account session is refused');
select is(public.embryo_upload_account_live_v1('7a810000-0000-4000-8000-000000000001',
 '7a810000-0000-4000-8000-000000000013'),false,'a session past the sensitive-action reauthentication window is refused');
select is(public.embryo_upload_account_live_v1('7a810000-0000-4000-8000-000000000001',
 '7a810000-0000-4000-8000-000000000014'),false,'an expired auth session is refused');
select is(public.embryo_upload_account_live_v1(null,null),false,'missing identity is refused');
select is(pg_temp.probe($p$delete from auth.sessions where id='7a810000-0000-4000-8000-000000000011'$p$),false,
 'a removed auth session is refused');
select is(pg_temp.probe($p$update auth.users set banned_until=clock_timestamp()+interval '1 day'
 where id='7a810000-0000-4000-8000-000000000001'$p$),false,'a banned account is refused');
select is(pg_temp.probe($p$update auth.users set deleted_at=clock_timestamp()
 where id='7a810000-0000-4000-8000-000000000001'$p$),false,'a deleted account is refused');
select is(pg_temp.probe($p$update public.profiles set deletion_requested_at=clock_timestamp()
 where id='7a810000-0000-4000-8000-000000000001'$p$),false,'an account in its deletion hold is refused');
select is(pg_temp.probe($p$delete from public.profiles where id='7a810000-0000-4000-8000-000000000001'$p$),false,
 'an absent account profile is refused');
select is(pg_temp.probe($p$insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
 values('7a810000-0000-4000-8000-000000000021','7a810000-0000-4000-8000-000000000001',
 'Synthetic factor','totp','verified','synthetic-stage-factor',now(),now())$p$),false,'MFA-enabled accounts cannot use an aal1 session');
select is(pg_temp.probe($p$insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
 values('7a810000-0000-4000-8000-000000000021','7a810000-0000-4000-8000-000000000001',
 'Synthetic factor','totp','verified','synthetic-stage-factor',now(),now());
 update auth.sessions set aal='aal2' where id='7a810000-0000-4000-8000-000000000011'$p$),true,
 'a current aal2 session satisfies its verified factor');
select ok((select (select count(*) from public.account_operation_nonces)=b.nonces
 and (select count(*) from public.embryo_operation_nonces)=b.embryo_nonces
 and (select count(*) from public.legal_audit_log)=b.audit from before_read b),
 'the read stores no operation nonce and appends no actor or audit event');
select * from finish();
rollback;
