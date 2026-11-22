-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Path A's own-account acceptance is reached only under
-- the test jurisdiction: every real jurisdiction is unreviewed for the
-- capabilities that create an adult-subject invitation and that let one
-- adult read another's shared results, so in production no acceptance
-- clock exists and no reader below meets one. It follows 20260907124212
-- (the Family report recipient), 20260907153506 (Health picture's
-- direction), 20260915120846 (the Family ancestry recipient),
-- 20260923101135 (the Portrait authority), 20260929140000 (the Family
-- group Copilot's turn state), 20261120120000 (the acceptance clocks it
-- reads) and 20261120130000 (the one-record Copilot scope that reads the
-- report recipient and the turn state as they are).
-- =====================================================================
--
-- D-156, owner decision of 22 November 2026, "The 72-hour hold covers an
-- inviter's reads of the invited adult's own record"
-- (docs/protocol/decisions.md): until 72 hours have passed and the second
-- notice has been accepted by the mail provider, and from 30 days until the
-- reminder has been accepted, the inviter sees nothing the new adult shares
-- with them, through every Family reader and Copilot. The adult's own use of
-- their record is not held. Test mode only today.
--
-- After a Path A acceptance the invited adult's files sit on their own
-- `self` record, which they share through the Family relationship; the
-- clocks 20261120120000 records sit on the accepted invitation, and the
-- mitigation decision it patched answers only for the `other_adult` record
-- the invitation created. This migration:
--
--   1. Adds the one question, private.adult_acceptance_inviter_held_v1(reader,
--      subject): true only when the subject is another account's `self`
--      record, the reader is the inviter of an accepted Path A invitation
--      whose record that account holds (a Path B record keeps its draft and
--      is never this case), and that acceptance's clocks, as
--      private.adult_acceptance_clock_state_v1 reads them, hold it: an account
--      recorded as created from the invitation until 72 hours after
--      acceptance and until the second notice's provider acceptance; every
--      account acceptance from 30 days until the reminder's. An acceptance
--      recorded before 20261120120000 has no clock and keeps the creation-time
--      comparison the decision keeps for it; it is never released. A notice
--      that ended unsent never releases. Nobody else is held: not the adult,
--      not any other grantee, not the inviter for anyone else's record.
--   2. Asks it at each Family reader's own grant checkpoint, patched in place:
--      the report recipient (Family person pages, the shared report reads and
--      their confirmation, and through it the Family group Copilot's members
--      and the one-record Copilot scope's grantee layers), the ancestry
--      recipient, Health picture's direction (the reader's inbound direction
--      only, so the adult's own view of the pair is never held), the Portrait
--      authority (the reader's side only, likewise) and the Copilot turn state
--      (a turn that read the record is unreadable to the inviter, as during a
--      pause; nothing is deleted). Each answers exactly as it answers with no
--      grant: not found, null, or a conversation that is not listed.
--   3. Adds public.adult_acceptance_inviter_held_subjects_v1, service-only,
--      through which the Family graph (src/lib/family/graph.ts) and the
--      Portrait page's pair read (src/lib/family/portrait.ts) drop the held
--      grants from what they read, so every page built on them, the
--      raw-browse pages included, shows what it shows when nothing is shared.
-- When a clock clears, nothing else happens: every reader asks again on its
-- next read and the reads resume. No queue, job or row is written here.
--
-- Every body is patched in place under the md5-guarded convention: the exact
-- predecessor md5 and ACL, one anchor each, the successor md5 and unchanged
-- ACL, volatility and owner asserted (55000 otherwise).

do $predecessor$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.family_report_recipient_v1(uuid,uuid,uuid,text)')
   and md5(pg_get_functiondef(p.oid))='692a52e391045b96addc465c8afbce0e' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.family_ancestry_recipient_v1(uuid,uuid,uuid,text)')
   and md5(pg_get_functiondef(p.oid))='5d379a615e41ef4a05ce84f1c8455d51' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.health_picture_direction_v1(uuid,uuid,uuid,uuid,text)')
   and md5(pg_get_functiondef(p.oid))='5433a806e2f7ff6319dd2989a677b130' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.family_portrait_authority_v1(uuid,uuid,uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='1ff3da517b6bc473985e8fd3e073bcaa' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.family_copilot_turn_state_v1(uuid,uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='ecaa3458595f82351127ec80e26cd4c2' and p.proacl::text='{postgres=X/postgres}')
  -- The clocks as 20261120120000 left their one reader.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.adult_acceptance_clock_state_v1(uuid)')
   and md5(pg_get_functiondef(p.oid))='6f566115c807f64e1c2a9413f2669fe1' and p.proacl::text='{postgres=X/postgres}')
  or to_regprocedure('private.adult_acceptance_inviter_held_v1(uuid,uuid)') is not null
  or to_regprocedure('public.adult_acceptance_inviter_held_subjects_v1(uuid,uuid[])') is not null then
  raise exception using errcode='55000',message='adult acceptance inviter reads prerequisite differs'; end if;
end;
$predecessor$;

-- 1. The question ------------------------------------------------------------------
-- Whether this reader, as the inviter of the subject's Path A acceptance,
-- reads nothing the subject shares right now. Path A's record is found as the
-- decision finds it (its draft is consumed at acceptance; a Path B record
-- keeps its draft), through the account that holds it, whatever became of it
-- since: a hold whose notice can no longer go is not released.
create function private.adult_acceptance_inviter_held_v1(p_reader_account_id uuid,p_subject_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(p_reader_account_id is not null and exists(
  select 1 from public.subjects d
  join public.subjects t on t.subject_account_id=d.subject_account_id and t.subject_class='other_adult'
  join public.subject_invitations i on i.target_kind='subject' and i.target_id=t.id
   and i.invitation_kind='adult_subject' and i.status='accepted' and i.accepted_at is not null
  join public.subject_principals ip on ip.id=i.inviter_principal_id and ip.account_id=p_reader_account_id
  cross join lateral (select private.adult_acceptance_clock_state_v1(i.id) clock) k
  where d.id=p_subject_id and d.subject_class='self' and d.subject_account_id<>p_reader_account_id
   and not exists(select 1 from public.adult_subject_drafts x where x.subject_id=t.id)
   and (case when k.clock is null
     -- Recorded before 20261120120000: the creation-time comparison, never released.
     then coalesce((select u.created_at from auth.users u where u.id=d.subject_account_id)>=i.created_at,true)
     else (k.clock->>'held')::boolean
      and (clock_timestamp()<i.accepted_at+interval '72 hours' or not (k.clock->>'holdReleased')::boolean) end
    -- From the 30-day boundary until the reminder has been accepted by the provider.
    or (clock_timestamp()>=i.accepted_at+interval '30 days'
     and not coalesce((k.clock->>'reNoticeDone')::boolean,false)))),false)
$$;
revoke all on function private.adult_acceptance_inviter_held_v1(uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 2. The door for the Family graph and the Portrait pair read ----------------------------
-- Of the records that share with this account, those whose shares it reads as
-- not shared now. Bounded; no reason is returned.
create function public.adult_acceptance_inviter_held_subjects_v1(p_account_id uuid,p_subject_ids uuid[])
returns uuid[] language plpgsql stable security definer set search_path='' as $$
begin
 if p_account_id is null or p_subject_ids is null or cardinality(p_subject_ids)>1000 then
  raise exception using errcode='22023',message='invalid_request'; end if;
 return (select coalesce(array_agg(x.id order by x.id),'{}'::uuid[])
  from (select distinct s.id from unnest(p_subject_ids) s(id) where s.id is not null) x
  where private.adult_acceptance_inviter_held_v1(p_account_id,x.id));
end $$;
revoke all on function public.adult_acceptance_inviter_held_subjects_v1(uuid,uuid[])
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.adult_acceptance_inviter_held_subjects_v1(uuid,uuid[]) to service_role;

-- 3. The readers, patched in place ----------------------------------------------------
-- Pattern of 20261120120000: each body md5-guarded with its exact reviewed ACL,
-- one anchor each, the successor md5 and unchanged ACL, volatility and owner
-- asserted (55000 otherwise).
do $patch_inviter_reads$
declare item record;definition text;before_acl aclitem[];before_volatile "char";before_owner oid;
begin
 for item in select * from (values
  -- Reports: the Family person pages, the shared report reads and their
  -- confirmation, the Family group Copilot's members, the one-record scope.
  (1,'private.family_report_recipient_v1(uuid,uuid,uuid,text)','692a52e391045b96addc465c8afbce0e',
   '5e36eec0ee7f83911fd0966730081145','{postgres=X/postgres}',
   $old$ select subject_account_id into v_owner from public.subjects where id=p_subject and subject_class='self';
$old$,
   $new$ select subject_account_id into v_owner from public.subjects where id=p_subject and subject_class='self';
 -- 20261122110000 (D-156): the inviter of this adult's Path A acceptance reads
 -- nothing they share while its hold or a due reminder stands, as with no grant.
 if private.adult_acceptance_inviter_held_v1(p_account,p_subject) then
  raise exception using errcode='42501',message='not_found'; end if;
$new$,
   'report recipient'),
  -- Ancestry: the same question at its own recipient.
  (2,'private.family_ancestry_recipient_v1(uuid,uuid,uuid,text)','5d379a615e41ef4a05ce84f1c8455d51',
   '9ba008dab0144ba55a6ac57fb68f7172','{postgres=X/postgres}',
   $old$ select subject_account_id into v_owner from public.subjects where id=p_subject and subject_class='self';
$old$,
   $new$ select subject_account_id into v_owner from public.subjects where id=p_subject and subject_class='self';
 -- 20261122110000 (D-156): the inviter of this adult's Path A acceptance reads
 -- nothing they share while its hold or a due reminder stands, as with no grant.
 if private.adult_acceptance_inviter_held_v1(p_account,p_subject) then
  raise exception using errcode='42501',message='not_found'; end if;
$new$,
   'ancestry recipient'),
  -- Health picture: the viewer's own inbound direction only.
  (3,'private.health_picture_direction_v1(uuid,uuid,uuid,uuid,text)','5433a806e2f7ff6319dd2989a677b130',
   'd496bc699608053982ded60110a64628','{postgres=X/postgres}',
   $old$ select subject_account_id into v_owner from public.subjects where id=p_subject and subject_class='self';
$old$,
   $new$ select subject_account_id into v_owner from public.subjects where id=p_subject and subject_class='self';
 -- 20261122110000 (D-156): what the counterpart shares with a viewer who is the
 -- inviter of their held Path A acceptance is not read; the viewer's outbound
 -- direction is never held, so the adult's own view of the pair opens.
 if p_account=p_viewer and private.adult_acceptance_inviter_held_v1(p_account,p_subject) then
  raise exception using errcode='42501',message='not_found'; end if;
$new$,
   'health picture direction'),
  -- Portrait: the reader's side of the pair only.
  (4,'private.family_portrait_authority_v1(uuid,uuid,uuid,uuid)','1ff3da517b6bc473985e8fd3e073bcaa',
   '437d6400ed4b83a6cb1da08be2195abf','{postgres=X/postgres}',
   $old$ session_receipt:=private.family_report_session_v1(p_account_id,p_session_id);
$old$,
   $new$ session_receipt:=private.family_report_session_v1(p_account_id,p_session_id);
 -- 20261122110000 (D-156): a reader who is the inviter of the counterpart's held
 -- Path A acceptance reads no pair with them, as with no grant; the counterpart's
 -- own view of the pair is never held.
 if private.adult_acceptance_inviter_held_v1(p_account_id,
   case when a.subject_account_id=p_account_id then b.id else a.id end) then return null; end if;
$new$,
   'portrait authority'),
  -- Copilot history, both scopes: unreadable while held, as during a pause.
  (5,'private.family_copilot_turn_state_v1(uuid,uuid,uuid)','ecaa3458595f82351127ec80e26cd4c2',
   '3ed921e9d872a5c557389a126a1af7ff','{postgres=X/postgres}',
   $old$    and private.family_sharing_paused_v1(s.subject_account_id,p_account) is not false) then 'paused'
$old$,
   $new$    and (private.family_sharing_paused_v1(s.subject_account_id,p_account) is not false
     -- 20261122110000 (D-156): a turn that read an adult's own record is not read
     -- by their inviter while the hold or a due reminder stands; nothing is
     -- deleted, and it reads again once the clock clears.
     or private.adult_acceptance_inviter_held_v1(p_account,s.id))) then 'paused'
$new$,
   'copilot turn state')
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
$patch_inviter_reads$;

do $postflight$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.adult_acceptance_inviter_held_v1(uuid,uuid)')
   and p.proacl::text='{postgres=X/postgres}' and p.prosecdef and p.provolatile='s')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.adult_acceptance_inviter_held_subjects_v1(uuid,uuid[])')
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef and p.provolatile='s') then
  raise exception using errcode='55000',message='adult acceptance inviter reads successor differs'; end if;
end;
$postflight$;
