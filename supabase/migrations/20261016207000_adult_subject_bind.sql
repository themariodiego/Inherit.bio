-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Path B is TEST-LOCAL only: the door below rechecks the
-- test-jurisdiction flag through private.adult_subject_control_v1.
-- =====================================================================
--
-- api.adult-subject-bind (register; G2.1 "Build all 24"; owner decision
-- 2026-10-22, "Consent, rights and claim endpoints"): a person who confirmed
-- a Path B request with no account binds that confirmation to their own
-- signed-in account (adult-subject-account-binding-v1), without any owner
-- transfer or object relocation.
--
-- BUILT CLOSED, on purpose:
--   * the door needs an adult-subject-control rights session, and no issuer
--     registers that purpose (20261016202000), so no session exists; and
--   * the account-binding notice the contract enqueues has no approved
--     wording. This door therefore sends no notice and enqueues no mail.
-- Until both exist, the route answers resource-not-found-v1, and this door
-- refuses every caller with 42501.
--
-- Owner decisions applied here:
--   * the bind is refused while any file of the subject is still pending,
--     as the transfer decision did (2026-10-16, "Transfer with held files");
--   * no 'pending_account_reaffirmation' status is added. Each current
--     purpose grant the non-account principal signed instead ends, as
--     superseded, in the same transaction: it authorizes nothing after the
--     bind, and the account must sign its own grants afresh. That is the
--     strictest reading the existing statuses allow.
--
-- public.bind_adult_subject_account_v1, in one transaction:
--   1. the account's own live auth session must be recent (15 minutes) and
--      at aal2 when MFA is enrolled (private.validate_sensitive_account_
--      session_v1); its profile is locked;
--   2. private.adult_subject_control_v1 locks the session, consumes its
--      one-time nonce for bind-account, rechecks the purpose matrix and locks
--      the subject (active other_adult, no subject account, a confirmed Path
--      B draft) and its active non-account principal at the bound revision;
--   3. the account is not the uploader, has no principal on the subject yet,
--      and its current declared jurisdiction equals the one the principal
--      signed its confirmation under;
--   4. no file of the subject is pending;
--   5. the principal's current grants end; the principal is detached and a
--      new account principal is written; subjects.subject_account_id is set
--      and the binding revision raised; each confirmed file takes the new
--      binding revision and keeps its confirming principal and clock;
--   6. every active rights session of the old principal is revoked, every
--      unsent mail row to it is invalidated, and its working contact copies
--      are crypto-shredded; one audit event.
--
-- No existing function, table, grant or constraint is changed.

do $predecessor$
begin
 if to_regprocedure('private.adult_subject_control_v1(text,text,text,text,boolean)') is null
  or to_regprocedure('private.validate_sensitive_account_session_v1(uuid,uuid)') is null
  or to_regprocedure('private.append_legal_audit_event(text,uuid,text,text,jsonb)') is null
  or not exists(select 1 from private.rights_purpose_matrix where purpose='adult-subject-control'
   and action='bind-account' and route_id='api.adult-subject-bind') then
  raise exception using errcode='55000',message='adult subject bind prerequisite missing'; end if;
 if to_regprocedure('public.bind_adult_subject_account_v1(text,text,uuid,uuid,boolean)') is not null then
  raise exception using errcode='55000',message='adult subject bind successor already exists'; end if;
end;
$predecessor$;

create function public.bind_adult_subject_account_v1(p_session_hash text,p_nonce text,p_account_id uuid,
 p_auth_session_id uuid,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare v_now timestamptz:=clock_timestamp(); c jsonb; pr public.profiles%rowtype; v_signed text;
 v_subject uuid; v_principal uuid; v_binding bigint; v_new_principal uuid; v_ended integer:=0;
begin
 if p_account_id is null or p_auth_session_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 perform private.validate_sensitive_account_session_v1(p_account_id,p_auth_session_id);
 perform 1 from auth.users u where u.id=p_account_id and u.deleted_at is null for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select * into pr from public.profiles where id=p_account_id for update;
 if pr.id is null then raise exception using errcode='42501',message='not_found'; end if;

 c:=private.adult_subject_control_v1(p_session_hash,p_nonce,'bind-account','api.adult-subject-bind',p_test_jurisdiction);
 v_subject:=(c->>'subjectId')::uuid; v_principal:=(c->>'principalId')::uuid;
 if (c->>'uploaderAccountId')::uuid=p_account_id
  or exists(select 1 from public.subject_principals sp where sp.subject_id=v_subject and sp.account_id=p_account_id
   and sp.status='active') then
  raise exception using errcode='42501',message='not_found'; end if;
 -- The account's own declaration must be the one the confirmation was signed under.
 select cs.jurisdiction_code into v_signed from public.consent_signatures cs
 where cs.signer_principal_id=v_principal and cs.target_kind='subject' and cs.target_id=v_subject
  and cs.purpose='adult-subject-path-b-confirmation' and cs.signer_account_id is null
 order by cs.signed_at desc limit 1;
 if v_signed is null or pr.jurisdiction_code is distinct from v_signed then
  raise exception using errcode='42501',message='not_found'; end if;
 -- No bind while any file of the subject is still pending.
 perform 1 from public.other_adult_held_uploads h where h.subject_id=v_subject for update;
 if exists(select 1 from public.other_adult_held_uploads h where h.subject_id=v_subject and h.state='pending') then
  raise exception using errcode='42501',message='not_found'; end if;

 -- The non-account principal's grants authorize nothing once it is bound.
 with ended as (
  update public.purpose_grants pg set revoked_at=v_now,revocation_reason='superseded'
  from public.directional_grants dg where dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
   and pg.signer_principal_id=v_principal and pg.revoked_at is null
  returning pg.grant_id
 ), dir as (
  update public.directional_grants set status='superseded',ended_at=v_now
  where grant_id in(select grant_id from ended) and status='current' returning 1
 ) select count(*) into v_ended from ended;

 update public.subject_principals set status='detached' where id=v_principal;
 insert into public.subject_principals(subject_id,account_id,principal_kind,status,principal_revision)
 values(v_subject,p_account_id,'account_subject','active',1) returning id into v_new_principal;
 update public.subjects set subject_account_id=p_account_id,subject_binding_revision=subject_binding_revision+1,
  updated_at=v_now where id=v_subject returning subject_binding_revision into v_binding;
 update public.other_adult_held_uploads set subject_binding_revision=v_binding
  where subject_id=v_subject and state='confirmed';

 update public.rights_sessions set status='revoked',ended_at=v_now where principal_id=v_principal and status='active';
 update public.mail_outbox set state='invalidated',claimed_at=null,last_outcome_code='recipient_authority_changed'
  where recipient_principal_id=v_principal and state in ('queued','claimed');
 update public.encrypted_contact_references set status='shredded',contact_ciphertext=null,ended_at=v_now
  where principal_id=v_principal and status<>'shredded';

 perform private.append_legal_audit_event('subject.account-bound',null,'api.adult-subject-bind','accepted',
  jsonb_build_object('ended_grants',v_ended,'binding_revision',v_binding));
 return jsonb_build_object('status','account_bound','subjectId',v_subject,
  'next','review_purposes_and_optionally_transfer_ownership');
end $$;
revoke all on function public.bind_adult_subject_account_v1(text,text,uuid,uuid,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.bind_adult_subject_account_v1(text,text,uuid,uuid,boolean) to service_role;

notify pgrst, 'reload schema';
