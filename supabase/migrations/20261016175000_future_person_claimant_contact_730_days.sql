-- The claimant's temporary contact class future-person.claimed-unbound-24mo is
-- exactly 730 days (G5.4; owner decision 2026-10-16, "Claimant retention
-- stated in days (G5.4)", docs/protocol/decisions.md).
--
-- FLAGGED: TEST-LOCAL. Claims are closed outside the test jurisdiction, so no
-- claimant contact clock exists on a hosted database. A later guarded release
-- is required before this reaches one.
--
-- Until now the clock was interval '24 months' from the release
-- (20260930237000_future_person_contact_retention.sql:17), which is 730 or
-- 731 days depending on the dates, and so could not be stated in days. Two
-- existing functions are patched in place, each guarded by its exact body:
--
--   1. private.queue_future_person_release_v1 writes the contact's retention
--      row, due phase, HMAC index expiry and the claimant's
--      contact_expires_at at the release plus exactly 730 x 24 hours,
--      independent of the session time zone. A documentary recovery uses the
--      same function, so its new fixed deadline is 730 days too.
--   2. private.purge_future_person_contact_phase_v1 binds a contact to its row
--      by that same rule.
--
-- No running clock is rewritten. The migration refuses to run if any
-- future-person.claimed-unbound-24mo row is still scheduled or active, because
-- moving an existing deadline is never allowed. Nothing else changes: the
-- record itself stays under future-person.claimant-reverification-until-request
-- until the claimant asks to delete it, and no table, column or grant changes.

do $predecessor$
begin
 if exists(select 1 from public.retention_rows where retention_id='future-person.claimed-unbound-24mo'
   and state in ('scheduled','active')) then
  raise exception using errcode='55000',message='claimant contact clocks are running; no deadline is rewritten'; end if;
 if not exists(select 1 from public.retention_phase_registry where retention_id='future-person.claimed-unbound-24mo'
   and phase_id='claimed-unbound-working-data-purge' and phase_kind='purge') then
  raise exception using errcode='55000',message='claimant contact retention prerequisite missing'; end if;
 if to_regprocedure('private.future_person_claimed_unbound_days_v1()') is not null then
  raise exception using errcode='55000',message='claimant contact successor already exists'; end if;
end;
$predecessor$;

-- The class's one number, in days. docs/retention.md is its authority.
create function private.future_person_claimed_unbound_days_v1()
returns integer language sql immutable set search_path='' as $$ select 730 $$;
revoke all on function private.future_person_claimed_unbound_days_v1()
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 1. The release writes the 730-day clock -----------------------------------
do $patch_release$
declare target regprocedure:='private.queue_future_person_release_v1(uuid,uuid,bytea,jsonb)'::regprocedure;
 definition text; before_acl aclitem[];
 old_fragment text:=$old$contact_expiry:=v_now+interval '24 months';$old$;
 new_fragment text:=$new$contact_expiry:=v_now+make_interval(hours=>24*private.future_person_claimed_unbound_days_v1());$new$;
begin
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc
  where oid=target and md5(prosrc)='f1f5e9786d47a0a6102b43276012ae31';
 if definition is null then raise exception using errcode='55000',message='claimant contact release predecessor differs'; end if;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='claimant contact release anchor differs'; end if;
 execute replace(definition,old_fragment,new_fragment);
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='4bf007b76ff40b3f55247b91e05f4343'
   and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='claimant contact release successor differs'; end if;
end;
$patch_release$;

-- 2. The purge binds a contact to that same clock ----------------------------
do $patch_purge$
declare target regprocedure:='private.purge_future_person_contact_phase_v1(uuid,timestamptz)'::regprocedure;
 definition text; before_acl aclitem[];
 old_fragment text:=$old$and t.fixed_deadline=c.created_at+interval '24 months')$old$;
 new_fragment text:=$new$and t.fixed_deadline=c.created_at+make_interval(hours=>24*private.future_person_claimed_unbound_days_v1()))$new$;
begin
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc
  where oid=target and md5(prosrc)='7d06d5f13edc7882cfe4d5a4a73f1922';
 if definition is null then raise exception using errcode='55000',message='claimant contact purge predecessor differs'; end if;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='claimant contact purge anchor differs'; end if;
 execute replace(definition,old_fragment,new_fragment);
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='3ead230272e5cba98bbd45075a3a3bbd'
   and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='claimant contact purge successor differs'; end if;
end;
$patch_purge$;
