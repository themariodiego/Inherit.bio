-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Path B is TEST-LOCAL only: its drafts, invitations,
-- confirmations and grants exist only under the test jurisdiction, so in
-- production no subject ever reaches the branch changed here.
-- =====================================================================
--
-- STATED PRIVACY-CONTROL CHANGE (owner decision 2026-10-22, "Uploader gate
-- for a person who confirmed with no account", docs/protocol/decisions.md;
-- recorded in docs/test-diff-register.md).
--
-- other-adult-mitigation-state-v1, case no-account-path-b: "skip only the
-- account-created-from-invitation 72-hour hold and require current
-- adult.non-account-holder-24mo confirmation principal ... and the same
-- adult.re-notice-30d state". Until now the no-account branch answered deny
-- (adult.non-account-holder-24mo) at every checkpoint, because the 730-day
-- confirmation state was not built. 20261016170000 built it. So the branch
-- now mirrors the account case, which allows until accepted+30 days:
--
--   allow   while the subject's active non_account_subject principal is
--           current, at least one of its confirmed files has a live
--           adult.non-account-holder-24mo clock (scheduled or active, fixed
--           deadline still ahead), and the request's acceptance is less than
--           30 days old;
--   deny    adult.re-notice-30d from accepted+30 days, exactly as the account
--           case (the re-notice is still not built);
--   deny    adult.non-account-holder-24mo when no such principal or no live
--           clock exists: before any file is confirmed, and after every clock
--           has ended.
--
-- The clock is read through its own upload session, never through the held
-- table: 20261016170000 cancels a clock in the same statement that ends its
-- confirmed file, so a running clock is itself the proof of a confirmed file,
-- and the reviewed census of functions that name the held table
-- (other_adult_held_upload.sql) is unchanged.
--
-- Only that branch changes. The 72-hour hold, the account case, the
-- subject-own-right-only case, every other recipient and every checkpoint
-- answer exactly as before. Every reader still needs the person's own
-- uploader-direction purpose grant, and the only door that writes one for a
-- person with no account (grant_purpose_rights_v1, 20261016203000) stays
-- closed until an adult-subject-control issuer exists.
--
-- The no-account branch lives in private.other_adult_mitigation_before_
-- public_appeal_v1, which private.other_adult_mitigation_v1 (20261009224500)
-- calls after its appeal hold. It is patched in place with the guard pattern
-- of 20261016195000: the exact predecessor body md5, one anchor, the pinned
-- successor md5 and unchanged privileges, volatility and owner.

do $predecessor$
begin
 if to_regprocedure('private.other_adult_mitigation_v1(uuid,uuid,text)') is null
  or to_regprocedure('private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)') is null
  or to_regprocedure('private.adult_non_account_holder_days_v1()') is null
  or to_regclass('public.upload_sessions') is null
  or to_regclass('public.retention_rows') is null then
  raise exception using errcode='55000',message='no-account uploader gate prerequisite missing'; end if;
end;
$predecessor$;

do $patch_gate$
declare target regprocedure:='private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)'::regprocedure;
 definition text; before_acl aclitem[]; before_volatile "char"; before_owner oid;
 old_fragment text:=$old$ if s.subject_account_id is null then
  return jsonb_build_object('decision','deny','gate','adult.non-account-holder-24mo'); end if;$old$;
 new_fragment text:=$new$ if s.subject_account_id is null then
  -- no-account-path-b (owner decision 2026-10-22): a current confirmation
  -- principal, a live 730-day clock and the same 30-day re-notice boundary.
  if not exists(select 1 from public.subject_principals np where np.subject_id=s.id
    and np.principal_kind='non_account_subject' and np.status='active' and np.account_id is null)
   or not exists(select 1 from public.upload_sessions us
    join public.retention_rows rr on rr.retention_id='adult.non-account-holder-24mo'
     and rr.target_kind='upload_session' and rr.target_id=us.id
     and rr.state in ('scheduled','active') and rr.fixed_deadline>clock_timestamp()
    where us.subject_id=s.id and us.upload_authority_kind='other-adult-held') then
   return jsonb_build_object('decision','deny','gate','adult.non-account-holder-24mo'); end if;
  if clock_timestamp()>=v_accepted_at+interval '30 days' then
   return jsonb_build_object('decision','deny','gate','adult.re-notice-30d'); end if;
  return jsonb_build_object('decision','allow','gate',null);
 end if;$new$;
begin
 select pg_get_functiondef(target),proacl,provolatile,proowner into definition,before_acl,before_volatile,before_owner
  from pg_proc where oid=target and md5(prosrc)='a877304153a110c6710edf20019cb647';
 if definition is null then raise exception using errcode='55000',message='no-account uploader gate predecessor differs'; end if;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='no-account uploader gate anchor differs'; end if;
 execute replace(definition,old_fragment,new_fragment);
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='29c74c79cb3eeedbbdac44273a6f4de3'
   and proacl is not distinct from before_acl and provolatile=before_volatile and proowner=before_owner) then
  raise exception using errcode='55000',message='no-account uploader gate successor differs'; end if;
end;
$patch_gate$;
