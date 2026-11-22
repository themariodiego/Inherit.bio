-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Path A's own-account acceptance and Path B are reached
-- only under the test jurisdiction: every real jurisdiction is unreviewed for
-- the capabilities that create an adult-subject invitation, so in production
-- no acceptance reaches the bodies patched here and no clock is started. It
-- follows 20260906053451 (the terminal-notice queue it uses), 20260930210000
-- and 20261016190000 (the Path B account core), 20260930220000,
-- 20261009224500 and 20261016204000 (the mitigation decision),
-- 20260930231000 (the normalization authority), 20261025400000 (Path A's
-- acceptance body) and 20261119160000 (the notice kinds it widens).
-- =====================================================================
--
-- D-141: the 72-hour hold on an account created from an invitation, the
-- second notice at 72 hours and the re-notice at 30 days (register
-- policyResolvers.other-adult-mitigation-state-v1, adult-subject-confirmation-v1
-- authenticatedTransaction, invitation-accepted-v1; docs/retention.md
-- adult.acceptance-hold-72h and adult.re-notice-30d). Coded to the signed
-- register under the owner's rule of 19 November 2026 ("G8.5: where the
-- register is stricter, engineering codes to it", docs/protocol/decisions.md).
--
-- Until now nothing recorded whether an accepting account was created from
-- the invitation: Path A answered every acceptance as an existing account and
-- the decision denied Path A records outright; Path B compared creation
-- times at every decision and never released the hold, and denied every
-- uploader from 30 days after acceptance for good. This migration:
--
--   1. Records the origin in the transaction that accepts, from a fact the
--      database holds: an account whose auth.users row was created at or
--      after this exact invitation was issued may have been created from it,
--      and is treated as created from it; an account that existed before the
--      invitation cannot have been. No request field is read. The record is
--      the register's own: the account acceptance starts adult.re-notice-30d
--      for every account and adult.acceptance-hold-72h only for an account
--      created from the invitation, as retention rows on the accepted
--      invitation with one registered due phase each, deadlines fixed at
--      acceptance (72 hours; 30 days). The re-notice phase's envelope names
--      the origin and the two times it was decided from. Path A
--      (private.adult_subject_invitation_response_v1) and Path B's account
--      branch (private.confirm_path_b_subject_account_core_v1, both Path B
--      flows) call one new function after they mark the invitation accepted.
--      The no-account Path B confirmation starts nothing here: see 6.
--   2. private.other_adult_mitigation_before_public_appeal_v1, behind the
--      appeal hold of private.other_adult_mitigation_v1, decides from that
--      record. For an uploader: an account created from the invitation is
--      denied adult.acceptance-hold-72h until 72 hours have passed and the
--      second notice has been accepted by the mail provider; from 30 days the
--      uploader is denied adult.re-notice-30d until the re-notice has been
--      accepted. For the person's own account: their own analysis and derived
--      reads wait out the same hold; their own rights (purpose choices,
--      export, download) never wait. Path A's record is found through its
--      own-account binding (its draft is consumed at acceptance); it has no
--      uploader and no grantee. An acceptance recorded before this migration
--      keeps the old comparison and is never released.
--   3. private.path_b_normalization_authority_v1 drops its own copy of the
--      30-day boundary from the authority deadline: the one decision above,
--      which this authority asks first at every checkpoint, owns it now, so
--      an accepted re-notice is not overruled by a second unconditional cut.
--   4. The two notices go through the terminal-notice queue and its worker
--      (20260906053451) as two more closed kinds, addressed to the person's
--      account: the worker reads that account's verified address only in its
--      own memory, as it does for an account recipient today.
--      public.run_due_adult_acceptance_notices_v1, run by jobs.retention,
--      queues each due notice once, or cancels it when the record is no
--      longer active and bound to that account, was transferred, the
--      account is being deleted, or the invited address is under the global
--      contact refusal bar. The claim and the send authorization of the
--      worker check the same again for these two kinds, each time. A trigger
--      on the queue records the provider's acceptance on the phase in the
--      transaction that records it, and a notice that ends unsent as failed.
--      Once released, the executor retries the normalization of any file the
--      person confirmed while the hold or the re-notice held it back, through
--      the existing private.enqueue_path_b_normalization_v1, which checks
--      every gate again.
--   5. public.adult_subject_acceptance_origin_v1 lets api.invitation-accept
--      answer the register's invitation-accepted-v1 body from the record.
--   6. Not built, for the owner: the re-notice to a person who confirmed with
--      no account (its only address is the request's contact, which the
--      register purges on the same 30-day boundary and forbids keeping for a
--      delivery); the reviewed-undeliverability path (no named-human review
--      exists for these notices). Both keep the uploader denied, as before.
--
-- Every body is patched in place under the md5-guarded convention: the exact
-- predecessor md5 and ACL, one anchor each, the successor md5 and unchanged
-- ACL, volatility and owner asserted (55000 otherwise).

do $predecessor$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)')
   and md5(pg_get_functiondef(p.oid))='99dfdec657617a2b4850f6632693ef51' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.confirm_path_b_subject_account_core_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean)')
   and md5(pg_get_functiondef(p.oid))='2b25a1fb389738bb23397c418612dd63' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)')
   and md5(pg_get_functiondef(p.oid))='55892f3ffba0f229626ca024647c134a' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.path_b_normalization_authority_v1(uuid,text)')
   and md5(pg_get_functiondef(p.oid))='969bc88e9758fe1b2425289c6e4dd3a5' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.claim_invitation_terminal_mail_v1()')
   and md5(pg_get_functiondef(p.oid))='a725fd9deff71e8d32a3d76400112366' and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.authorize_invitation_terminal_mail_v1(uuid,smallint)')
   and md5(pg_get_functiondef(p.oid))='a4448da4d509e964b4cfe493dc6c8996' and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  -- The retry this executor makes after a release, as 20261003030000 left it.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.enqueue_path_b_normalization_v1(uuid)')
   and md5(pg_get_functiondef(p.oid))='8299149090c6d48d6ec52cfe75ab1af6' and p.proacl::text='{postgres=X/postgres}')
  -- The notice kinds as 20261119160000 left them, and the queue's one trigger.
  or (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c
   where c.conrelid='private.invitation_terminal_notices'::regclass and c.conname='invitation_terminal_notices_notice_kind_check'
    and c.contype='c' and c.convalidated) is distinct from '237de83b1bd70e3587147bb307883b96'
  or (select count(*) from pg_trigger t where t.tgrelid='private.invitation_terminal_notices'::regclass and not t.tgisinternal)<>1
  -- The global bar and the lock every invitation writer takes first.
  or not exists(select 1 from pg_proc p where p.pronamespace='private'::regnamespace and p.proname='invitation_contact_barred_v1'
   and md5(pg_get_functiondef(p.oid))='78c6413be21d2c662e515764a39748b3')
  or to_regprocedure('private.lock_invitation_transitions_v1()') is null
  -- The two registered classes and their one notice phase each.
  or (select count(*) from public.retention_registry where execution_class='scheduledDuePhase'
   and retention_id in ('adult.acceptance-hold-72h','adult.re-notice-30d'))<>2
  or (select count(*) from public.retention_phase_registry where phase_kind='notice-enqueue'
   and (retention_id,phase_id) in (('adult.acceptance-hold-72h','adult-acceptance-second-notice'),
    ('adult.re-notice-30d','adult-revocation-renotice')))<>2
  -- No clock of either class exists yet: nothing started one before.
  or exists(select 1 from public.retention_rows where retention_id in ('adult.acceptance-hold-72h','adult.re-notice-30d'))
  or to_regprocedure('private.start_adult_acceptance_clocks_v1(uuid)') is not null
  or to_regprocedure('private.adult_acceptance_clock_state_v1(uuid)') is not null
  or to_regprocedure('private.adult_acceptance_notice_current_v1(uuid)') is not null
  or to_regprocedure('private.settle_adult_acceptance_notice_v1()') is not null
  or to_regprocedure('public.run_due_adult_acceptance_notices_v1()') is not null
  or to_regprocedure('public.adult_subject_acceptance_origin_v1(uuid,uuid)') is not null then
  raise exception using errcode='55000',message='adult acceptance hold prerequisite differs'; end if;
end;
$predecessor$;

-- 1. The two notice kinds ----------------------------------------------------------
alter table private.invitation_terminal_notices drop constraint invitation_terminal_notices_notice_kind_check;
alter table private.invitation_terminal_notices add constraint invitation_terminal_notices_notice_kind_check
 check (notice_kind in ('invitation-refused','draft-cancelled','donor-attribution-ended','upload-permission-withdrawn',
  'adult-acceptance-second-notice','adult-revocation-renotice'));

-- 2. The clocks an account acceptance starts ----------------------------------------
-- Called only by the two acceptance bodies below, after they marked this
-- invitation accepted, inside their transaction. The origin is decided here
-- from the auth row and the invitation row, never from the request. A clock
-- that cannot be written rolls the whole acceptance back.
create function private.start_adult_acceptance_clocks_v1(p_invitation_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare i public.subject_invitations%rowtype; s public.subjects%rowtype; p public.subject_principals%rowtype;
 v_created timestamptz; v_origin text; v_row uuid; v_envelope jsonb;
begin
 select * into i from public.subject_invitations where id=p_invitation_id;
 if i.id is null or i.invitation_kind<>'adult_subject' or i.target_kind<>'subject' or i.status<>'accepted'
  or i.accepted_at is null then
  raise exception using errcode='55000',message='adult_acceptance_clock_unavailable'; end if;
 select * into s from public.subjects where id=i.target_id;
 select * into p from public.subject_principals where id=i.invitee_principal_id;
 if s.id is null or s.subject_class<>'other_adult' or s.subject_account_id is null or p.id is null
  or p.subject_id<>s.id or p.account_id is distinct from s.subject_account_id
  or p.principal_kind<>'account_subject' or p.status<>'active' then
  raise exception using errcode='55000',message='adult_acceptance_clock_unavailable'; end if;
 -- Only an account the auth row shows existed before this invitation was
 -- issued is an existing account; anything else, a missing time included,
 -- is held.
 select u.created_at into v_created from auth.users u where u.id=s.subject_account_id;
 v_origin:=case when v_created<i.created_at then 'existing_account' else 'created_from_this_invitation' end;
 v_envelope:=jsonb_build_object('accountOrigin',v_origin,'acceptedAt',i.accepted_at,
  'invitationIssuedAt',i.created_at,'accountCreatedAt',v_created);
 -- adult.re-notice-30d: every account acceptance.
 insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
  disposition_revision,fixed_deadline)
 values('adult.re-notice-30d','invitation',i.id,1,s.lifecycle_revision,1,i.accepted_at+interval '30 days')
 returning id into v_row;
 insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
  target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,
  immutable_envelope)
 values(v_row,'adult.re-notice-30d','adult-revocation-renotice','notice-enqueue',1,i.accepted_at+interval '30 days',
  'invitation',i.id,s.lifecycle_revision,1,'subject-account',p.principal_revision,v_envelope);
 -- adult.acceptance-hold-72h: only an account created from this invitation.
 if v_origin='created_from_this_invitation' then
  insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
   disposition_revision,fixed_deadline)
  values('adult.acceptance-hold-72h','invitation',i.id,1,s.lifecycle_revision,1,i.accepted_at+interval '72 hours')
  returning id into v_row;
  insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
   target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,
   immutable_envelope)
  values(v_row,'adult.acceptance-hold-72h','adult-acceptance-second-notice','notice-enqueue',1,
   i.accepted_at+interval '72 hours','invitation',i.id,s.lifecycle_revision,1,'subject-account',p.principal_revision,v_envelope);
 end if;
 return v_origin;
end $$;
revoke all on function private.start_adult_acceptance_clocks_v1(uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 3. What the decision reads -------------------------------------------------------
-- Null for an acceptance recorded before this migration (or none): the
-- decision then keeps its old comparison. Otherwise whether the hold applies
-- and whether each notice has been accepted by the provider.
create function private.adult_acceptance_clock_state_v1(p_invitation_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.retention_rows r where r.retention_id='adult.re-notice-30d'
   and r.target_kind='invitation' and r.target_id=p_invitation_id) then jsonb_build_object(
  'held',exists(select 1 from public.retention_rows r where r.retention_id='adult.acceptance-hold-72h'
   and r.target_kind='invitation' and r.target_id=p_invitation_id),
  'holdReleased',exists(select 1 from public.retention_due_phases d where d.retention_id='adult.acceptance-hold-72h'
   and d.phase_id='adult-acceptance-second-notice' and d.target_kind='invitation' and d.target_id=p_invitation_id
   and d.status='succeeded'),
  'reNoticeDone',exists(select 1 from public.retention_due_phases d where d.retention_id='adult.re-notice-30d'
   and d.phase_id='adult-revocation-renotice' and d.target_kind='invitation' and d.target_id=p_invitation_id
   and d.status='succeeded')) end
$$;
revoke all on function private.adult_acceptance_clock_state_v1(uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 4. Whether one of the two notices may still go ------------------------------------
-- True for every other kind (this check is not theirs). For the two kinds: the
-- accepted invitation's record is still active, other_adult, bound to the
-- recipient account and not transferred; its phase still waits on exactly
-- this notice; and the invited address is not under the global refusal bar.
-- The recipient account itself is checked by the queue's own recipient check.
create function private.adult_acceptance_notice_current_v1(p_notice_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from private.invitation_terminal_notices n where n.id=p_notice_id
   and n.notice_kind in ('adult-acceptance-second-notice','adult-revocation-renotice'))
  or exists(select 1 from private.invitation_terminal_notices n
   join public.subject_invitations i on i.id=n.invitation_id and i.invitation_kind='adult_subject'
    and i.target_kind='subject' and i.status='accepted'
   join public.subjects s on s.id=i.target_id and s.subject_class='other_adult' and s.lifecycle='active'
    and s.subject_account_id=n.recipient_account_id and s.ownership_transferred_at is null
   join public.retention_due_phases d on d.phase_id=n.notice_kind and d.target_kind='invitation'
    and d.target_id=i.id and d.status='claimed' and d.claim_token_hash=n.idempotency_key
   where n.id=p_notice_id and n.state='pending' and n.recipient_kind='account'
    and not private.invitation_contact_barred_v1(i.email_hmac))
$$;
revoke all on function private.adult_acceptance_notice_current_v1(uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 5. Bodies patched in place ----------------------------------------------------------
-- Pattern of 20261119160000: each body md5-guarded with its exact reviewed ACL,
-- one anchor each, the successor md5 and unchanged ACL, volatility and owner
-- asserted (55000 otherwise).
do $patch_hold$
declare item record;definition text;before_acl aclitem[];before_volatile "char";before_owner oid;
begin
 for item in select * from (values
  -- Path A: the clocks start in the acceptance's own transaction.
  (1,'private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)','99dfdec657617a2b4850f6632693ef51',
   'bb4234666d681aeb85f3d41ed9e5121a','{postgres=X/postgres}',
   $old$    update public.subject_invitations
    set status = 'accepted', accepted_at = v_now, terminal_at = v_now,
        contact_purge_due_at = v_now + interval '30 days'
    where id = v_invitation.id;
$old$,
   $new$    update public.subject_invitations
    set status = 'accepted', accepted_at = v_now, terminal_at = v_now,
        contact_purge_due_at = v_now + interval '30 days'
    where id = v_invitation.id;
    -- 20261120120000 (D-141): whether this account was created from this
    -- invitation is recorded here, with the clocks it starts.
    perform private.start_adult_acceptance_clocks_v1(v_invitation.id);
$new$,
   'path a acceptance'),
  -- Path B's account branch, both flows.
  (2,'private.confirm_path_b_subject_account_core_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean)',
   '2b25a1fb389738bb23397c418612dd63','63c6c510a724cbe747af5db354cb344b','{postgres=X/postgres}',
   $old$ update public.subject_invitations set status='accepted',accepted_at=v_now,terminal_at=v_now,
  contact_purge_due_at=v_now+interval '30 days' where id=v_invitation.id;
$old$,
   $new$ update public.subject_invitations set status='accepted',accepted_at=v_now,terminal_at=v_now,
  contact_purge_due_at=v_now+interval '30 days' where id=v_invitation.id;
 -- 20261120120000 (D-141): the origin and the clocks, in this transaction.
 perform private.start_adult_acceptance_clocks_v1(v_invitation.id);
$new$,
   'path b account acceptance'),
  -- The decision: its variables.
  (3,'private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)','55892f3ffba0f229626ca024647c134a',
   '8864524071b266426d978e106b6711d0','{postgres=X/postgres}',
   $old$declare s public.subjects%rowtype; v_invited_at timestamptz; v_accepted_at timestamptz; v_created timestamptz;
$old$,
   $new$declare s public.subjects%rowtype; v_invited_at timestamptz; v_accepted_at timestamptz; v_created timestamptz;
 -- 20261120120000 (D-141): the accepted invitation and the clocks it started.
 v_invitation uuid; v_clock jsonb;
$new$,
   'mitigation variables'),
  -- The decision: the acceptance, Path A included, and its record.
  (4,'private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)','8864524071b266426d978e106b6711d0',
   '99b4ddcb5f80f2a4fb384b530b2c1502','{postgres=X/postgres}',
   $old$ select i.created_at,i.accepted_at into v_invited_at,v_accepted_at from public.subject_invitations i
  join public.adult_subject_drafts d on d.subject_id=i.target_id and d.adult_flow='path-b-subject-esignature'
   and d.state='confirmed'
  where i.target_kind='subject' and i.target_id=p_subject_id and i.invitation_kind='adult_subject'
   and i.status='accepted'
  order by i.accepted_at desc limit 1;
$old$,
   $new$ select i.id,i.created_at,i.accepted_at into v_invitation,v_invited_at,v_accepted_at from public.subject_invitations i
  join public.adult_subject_drafts d on d.subject_id=i.target_id and d.adult_flow='path-b-subject-esignature'
   and d.state='confirmed'
  where i.target_kind='subject' and i.target_id=p_subject_id and i.invitation_kind='adult_subject'
   and i.status='accepted'
  order by i.accepted_at desc limit 1;
 -- 20261120120000 (D-141): Path A, the invited adult's own record. Its draft
 -- is consumed at acceptance, so it is found by its own-account binding. It
 -- has no uploader and no grantee: anyone but the person is not found below.
 if v_accepted_at is null then
  select i.id,i.created_at,i.accepted_at into v_invitation,v_invited_at,v_accepted_at
  from public.subject_invitations i join public.subjects t on t.id=i.target_id
  where i.target_kind='subject' and i.target_id=p_subject_id and i.invitation_kind='adult_subject'
   and i.status='accepted' and t.owner_account_id is null and t.subject_account_id is not null
   and not exists(select 1 from public.adult_subject_drafts d where d.subject_id=t.id)
   and exists(select 1 from public.subject_account_bindings b where b.subject_id=t.id
    and b.account_id=t.subject_account_id and b.binding_kind='adult_claim' and b.status='current')
  order by i.accepted_at desc limit 1;
 end if;
 v_clock:=private.adult_acceptance_clock_state_v1(v_invitation);
$new$,
   'mitigation acceptance'),
  -- The decision: the person's own account during the hold.
  (5,'private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)','99b4ddcb5f80f2a4fb384b530b2c1502',
   '4aa844173516d17aa462fb4ff2048e67','{postgres=X/postgres}',
   $old$ if p_account_id=s.subject_account_id then
  return jsonb_build_object('decision','subject-own-right-only','gate',null); end if;
$old$,
   $new$ if p_account_id=s.subject_account_id then
  -- 20261120120000 (D-141): while an account created from the invitation is
  -- held, the person's own analysis and derived reads wait too; their own
  -- rights (purpose choices, export, download, refusal, deletion) never do.
  if (v_clock->>'held')::boolean and (clock_timestamp()<v_accepted_at+interval '72 hours'
    or not (v_clock->>'holdReleased')::boolean)
   and p_checkpoint in ('route-read-before-fetch','model-context-before-retrieval','analysis-enqueue',
    'worker-claim','source-read-and-every-bounded-range','derived-write-and-read') then
   return jsonb_build_object('decision','deny','gate','adult.acceptance-hold-72h'); end if;
  return jsonb_build_object('decision','subject-own-right-only','gate',null); end if;
$new$,
   'mitigation own account'),
  -- The decision: the uploader of an account-bound person.
  (6,'private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)','4aa844173516d17aa462fb4ff2048e67',
   '91dfb6e4abf766e3da6e5827d4381daf','{postgres=X/postgres}',
   $old$ select u.created_at into v_created from auth.users u where u.id=s.subject_account_id;
 if v_created is null or v_created>=v_invited_at then
  return jsonb_build_object('decision','deny','gate','adult.acceptance-hold-72h'); end if;
 if clock_timestamp()>=v_accepted_at+interval '30 days' then
  return jsonb_build_object('decision','deny','gate','adult.re-notice-30d'); end if;
$old$,
   $new$ -- 20261120120000 (D-141): the origin recorded when this acceptance committed
 -- decides the hold, which ends 72 hours after acceptance once the second
 -- notice has been accepted by the provider. An acceptance recorded before
 -- then keeps the old comparison, and its hold never ends.
 if v_clock is null then
  select u.created_at into v_created from auth.users u where u.id=s.subject_account_id;
  if v_created is null or v_created>=v_invited_at then
   return jsonb_build_object('decision','deny','gate','adult.acceptance-hold-72h'); end if;
 elsif (v_clock->>'held')::boolean and (clock_timestamp()<v_accepted_at+interval '72 hours'
   or not (v_clock->>'holdReleased')::boolean) then
  return jsonb_build_object('decision','deny','gate','adult.acceptance-hold-72h');
 end if;
 -- From the 30-day boundary until the re-notice has been accepted by the provider.
 if clock_timestamp()>=v_accepted_at+interval '30 days' and not coalesce((v_clock->>'reNoticeDone')::boolean,false) then
  return jsonb_build_object('decision','deny','gate','adult.re-notice-30d'); end if;
$new$,
   'mitigation uploader'),
  -- The normalization authority leaves the 30-day boundary to the decision.
  (7,'private.path_b_normalization_authority_v1(uuid,text)','969bc88e9758fe1b2425289c6e4dd3a5',
   '591fc9f913fb7177ed86144a7ce654f4','{postgres=X/postgres}',
   $old$ select least(i.accepted_at+interval '30 days',sc.expires_at) into v_authority_deadline
$old$,
   $new$ -- 20261120120000 (D-141): the 30-day boundary and its re-notice are the
 -- mitigation decision's, asked above at this checkpoint; this deadline is
 -- the uploader consent's own.
 select coalesce(sc.expires_at,'infinity'::timestamptz) into v_authority_deadline
$new$,
   'normalization authority'),
  -- The worker's claim drops one of the two notices that may no longer go.
  (8,'public.claim_invitation_terminal_mail_v1()','a725fd9deff71e8d32a3d76400112366',
   '3524eba4d0dd916bef2c4dac1e5c25cb','{postgres=X/postgres,service_role=X/postgres}',
   $old$  and not private.invitation_notice_recipient_current_v1(q.invitation_terminal_notice_id);
$old$,
   $new$  and (not private.invitation_notice_recipient_current_v1(q.invitation_terminal_notice_id)
   -- 20261120120000 (D-141): the second notice and the re-notice, each time.
   or not private.adult_acceptance_notice_current_v1(q.invitation_terminal_notice_id));
$new$,
   'terminal mail claim'),
  -- ... and its send authorization refuses one, before and after the address is read.
  (9,'public.authorize_invitation_terminal_mail_v1(uuid,smallint)','a4448da4d509e964b4cfe493dc6c8996',
   '5ba9fd2ef4bfa2c36ec0e2be4b97aeb5','{postgres=X/postgres,service_role=X/postgres}',
   $old$  or not private.invitation_notice_recipient_current_v1(m.invitation_terminal_notice_id)
 then return false; end if;
$old$,
   $new$  or not private.invitation_notice_recipient_current_v1(m.invitation_terminal_notice_id)
  -- 20261120120000 (D-141): the second notice and the re-notice, each time.
  or not private.adult_acceptance_notice_current_v1(m.invitation_terminal_notice_id)
 then return false; end if;
$new$,
   'terminal mail authorization')
 ) as patch(ordinal,target,before_md5,after_md5,acl,old_fragment,new_fragment,label) order by ordinal loop
  select pg_get_functiondef(p.oid),p.proacl,p.provolatile,p.proowner into definition,before_acl,before_volatile,before_owner
   from pg_proc p where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.before_md5 and p.proacl::text=item.acl;
  if definition is null then raise exception using errcode='55000',message=item.label||' predecessor differs';end if;
  if (length(definition)-length(replace(definition,item.old_fragment,'')))/length(item.old_fragment)<>1 then
   raise exception using errcode='55000',message=item.label||' anchor differs';end if;
  execute replace(definition,item.old_fragment,item.new_fragment);
  if not exists(select 1 from pg_proc p where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.after_md5
    and p.proacl is not distinct from before_acl and p.provolatile=before_volatile and p.proowner=before_owner) then
   raise exception using errcode='55000',message=item.label||' successor differs';end if;
 end loop;
end;
$patch_hold$;

-- 6. The provider's answer, on the phase ------------------------------------------
-- In the transaction that records it: accepted by the provider (the queue's
-- complete step sets the notice enqueued) makes the phase succeeded; a notice
-- that ends unsent (invalidated by the claim, or removed at its expiry while
-- still pending) fails the phase and cancels its clock, so a hold whose
-- second notice never went is never released.
create function private.settle_adult_acceptance_notice_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare n private.invitation_terminal_notices%rowtype; v_status text; v_code text; v_now timestamptz:=clock_timestamp();
begin
 if tg_op='DELETE' then
  if old.state<>'pending' then return null; end if;
  n:=old; v_status:='failed'; v_code:='notice_not_sent';
 elsif old.state='pending' and new.state='enqueued' then
  n:=new; v_status:='succeeded'; v_code:='provider_submission_accepted';
 elsif old.state='pending' and new.state='expired' then
  n:=new; v_status:='failed'; v_code:='notice_not_sent';
 else
  return null;
 end if;
 update public.retention_due_phases set status=v_status,claim_token_hash=null,claim_expires_at=null,
  completed_at=v_now,terminal_outcome_code=v_code
 where phase_id=n.notice_kind and target_kind='invitation' and target_id=n.invitation_id
  and status='claimed' and claim_token_hash=n.idempotency_key;
 if v_status='failed' then
  update public.retention_rows set state='cancelled',ended_at=v_now
  where retention_id=case n.notice_kind when 'adult-acceptance-second-notice' then 'adult.acceptance-hold-72h'
    else 'adult.re-notice-30d' end
   and target_kind='invitation' and target_id=n.invitation_id and state in ('scheduled','active');
 end if;
 return null;
end $$;
revoke all on function private.settle_adult_acceptance_notice_v1()
 from public,anon,authenticated,inherit_upload_only,service_role;
create trigger settle_adult_acceptance_notice after update of state or delete on private.invitation_terminal_notices
 for each row when (old.notice_kind in ('adult-acceptance-second-notice','adult-revocation-renotice'))
 execute function private.settle_adult_acceptance_notice_v1();

-- 7. The retention job's executor --------------------------------------------------
-- Selected by the database; no selector, clock or batch comes from the caller.
-- Serialized with every acceptance, refusal and deletion by the same lock.
create function public.run_due_adult_acceptance_notices_v1()
returns integer language plpgsql security definer set search_path='' as $$
declare v record; h record; r record; i public.subject_invitations%rowtype; s public.subjects%rowtype;
 p public.subject_principals%rowtype; v_now timestamptz; v_key text; v_expires timestamptz; v_reason text; n integer:=0;
begin
 perform private.lock_invitation_transitions_v1();
 v_now:=clock_timestamp();
 -- A notice that left the queue unanswered past its expiry failed (the queue's
 -- trigger normally records this first).
 for v in select d.retention_row_id,d.retention_id,d.phase_id,d.phase_revision from public.retention_due_phases d
  where d.phase_id in ('adult-acceptance-second-notice','adult-revocation-renotice') and d.target_kind='invitation'
   and d.status='claimed' and d.claim_expires_at<=v_now
   and not exists(select 1 from private.invitation_terminal_notices t where t.idempotency_key=d.claim_token_hash
    and t.state='pending')
  for update of d skip locked
 loop
  update public.retention_due_phases set status='failed',claim_token_hash=null,claim_expires_at=null,
   completed_at=v_now,terminal_outcome_code='notice_not_sent'
  where retention_row_id=v.retention_row_id and phase_id=v.phase_id and phase_revision=v.phase_revision;
  update public.retention_rows set state='cancelled',ended_at=v_now
  where id=v.retention_row_id and state in ('scheduled','active');
 end loop;
 -- Each due notice is queued once, or cancelled when it may no longer go.
 for v in select d.retention_row_id,d.retention_id,d.phase_id,d.phase_revision,d.target_id
  from public.retention_due_phases d join public.retention_rows w on w.id=d.retention_row_id
  where d.phase_id in ('adult-acceptance-second-notice','adult-revocation-renotice')
   and d.retention_id in ('adult.acceptance-hold-72h','adult.re-notice-30d') and d.target_kind='invitation'
   and d.status in ('pending','retry') and d.phase_deadline<=v_now
   and w.retention_id=d.retention_id and w.target_kind='invitation' and w.target_id=d.target_id and w.state='scheduled'
  order by d.phase_deadline,d.retention_row_id
  for update of d,w skip locked
 loop
  select * into i from public.subject_invitations where id=v.target_id for update;
  select * into s from public.subjects where id=i.target_id for update;
  select * into p from public.subject_principals where id=i.invitee_principal_id for update;
  v_reason:=case
   when i.id is null or i.status<>'accepted' or s.id is null then 'invitation_not_current'
   when s.lifecycle<>'active' or s.subject_class<>'other_adult' or s.subject_account_id is null then 'subject_not_current'
   when s.ownership_transferred_at is not null then 'subject_transferred'
   when p.id is null or p.status<>'active' or p.principal_kind<>'account_subject'
    or p.account_id is distinct from s.subject_account_id then 'recipient_not_current'
   when exists(select 1 from public.profiles f where f.id=s.subject_account_id and f.deletion_requested_at is not null)
    or exists(select 1 from public.account_deletion_requests q where q.account_id=s.subject_account_id
     and q.state in ('notice_period','delete_started')) then 'account_deleting'
   when private.invitation_contact_barred_v1(i.email_hmac) then 'contact_barred'
  end;
  if v_reason is not null then
   update public.retention_due_phases set status='cancelled',claim_token_hash=null,claim_expires_at=null,
    completed_at=v_now,terminal_outcome_code=v_reason
   where retention_row_id=v.retention_row_id and phase_id=v.phase_id and phase_revision=v.phase_revision;
   update public.retention_rows set state='cancelled',ended_at=v_now where id=v.retention_row_id;
   continue;
  end if;
  v_key:=encode(extensions.digest(convert_to('adult-acceptance-notice-v1|'||v.phase_id||'|'||i.id::text,'UTF8'),'sha256'),'hex');
  v_expires:=v_now+interval '7 days';
  insert into private.invitation_terminal_notices(invitation_id,notice_kind,recipient_kind,recipient_account_id,
   recipient_authority_revision,idempotency_key,created_at,expires_at)
  values(i.id,v.phase_id,'account',s.subject_account_id,p.principal_revision,v_key,v_now,v_expires)
  on conflict(idempotency_key) do nothing;
  update public.retention_due_phases set status='claimed',claim_token_hash=v_key,claim_expires_at=v_expires,
   attempts=attempts+1
  where retention_row_id=v.retention_row_id and phase_id=v.phase_id and phase_revision=v.phase_revision;
  update public.retention_rows set state='active' where id=v.retention_row_id;
  n:=n+1;
 end loop;
 -- Released: a file the person confirmed while this clock held it back gets
 -- its normalization now, through the enqueue that checks every gate again.
 for h in select w.id,w.target_id from public.retention_rows w join public.retention_due_phases d on d.retention_row_id=w.id
  where w.retention_id in ('adult.acceptance-hold-72h','adult.re-notice-30d') and w.target_kind='invitation'
   and w.state='active' and d.status='succeeded'
  order by w.id for update of w skip locked
 loop
  for r in select u.id from public.other_adult_held_uploads u join public.subject_invitations i2 on i2.target_id=u.subject_id
   where i2.id=h.target_id and u.state='confirmed' and u.analysis_state='confirmed_blocked_current_gate'
   order by u.confirmed_at,u.id
  loop
   begin
    perform private.enqueue_path_b_normalization_v1(r.id);
   exception when insufficient_privilege then
    -- Another gate still holds it: the existing named blocked result.
    null;
   end;
  end loop;
  update public.retention_rows set state='complete',ended_at=v_now where id=h.id;
 end loop;
 return n;
end $$;
revoke all on function public.run_due_adult_acceptance_notices_v1() from public,anon,authenticated,inherit_upload_only;
grant execute on function public.run_due_adult_acceptance_notices_v1() to service_role;

-- 8. The acceptance's answer -----------------------------------------------------
-- The origin recorded for the person's accepted invitation of this record, or
-- null. api.invitation-accept reads it after the acceptance committed.
create function public.adult_subject_acceptance_origin_v1(p_account_id uuid,p_subject_id uuid)
returns text language sql stable security definer set search_path='' as $$
 select d.immutable_envelope->>'accountOrigin' from public.subject_invitations i
  join public.subjects s on s.id=i.target_id and s.subject_account_id=p_account_id
  join public.retention_due_phases d on d.retention_id='adult.re-notice-30d' and d.phase_id='adult-revocation-renotice'
   and d.target_kind='invitation' and d.target_id=i.id
 where p_account_id is not null and i.target_kind='subject' and i.target_id=p_subject_id
  and i.invitation_kind='adult_subject' and i.status='accepted'
 order by i.accepted_at desc limit 1
$$;
revoke all on function public.adult_subject_acceptance_origin_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.adult_subject_acceptance_origin_v1(uuid,uuid) to service_role;

do $postflight$
begin
 if (select count(*) from pg_proc p where p.oid in (
   to_regprocedure('private.start_adult_acceptance_clocks_v1(uuid)'),
   to_regprocedure('private.adult_acceptance_clock_state_v1(uuid)'),
   to_regprocedure('private.adult_acceptance_notice_current_v1(uuid)'),
   to_regprocedure('private.settle_adult_acceptance_notice_v1()'))
   and p.proacl::text='{postgres=X/postgres}' and p.prosecdef)<>4
  or (select count(*) from pg_proc p where p.oid in (
   to_regprocedure('public.run_due_adult_acceptance_notices_v1()'),
   to_regprocedure('public.adult_subject_acceptance_origin_v1(uuid,uuid)'))
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef)<>2
  or (select count(*) from pg_trigger t where t.tgrelid='private.invitation_terminal_notices'::regclass and not t.tgisinternal)<>2 then
  raise exception using errcode='55000',message='adult acceptance hold successor differs'; end if;
end;
$postflight$;
