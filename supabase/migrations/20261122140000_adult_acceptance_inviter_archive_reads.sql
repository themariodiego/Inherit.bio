-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. The account archive branch it patches is the native
-- complete archive, which runs only while private.account_archive_r2_configuration
-- is enabled (the TEST archive; off by default), and Path A's acceptance is
-- reached only under the test jurisdiction: in production no acceptance clock
-- exists and no archive meets one. It follows 20261010190500 (the complete
-- archive whose four bodies it patches) and 20261122110000 (the question it
-- asks).
-- =====================================================================
--
-- D-156, owner decision of 22 November 2026, "The 72-hour hold covers an
-- inviter's reads of the invited adult's own record"
-- (docs/protocol/decisions.md): until 72 hours have passed and the second
-- notice has been accepted by the mail provider, and from 30 days until the
-- reminder has been accepted, the inviter sees nothing the new adult shares
-- with them. 20261122110000 held the Family readers and Copilot. The inviter's
-- own account archive is a third read of what the adult shares: through
-- export.share-link and raw.export it carries the adult's saved reports,
-- scores, ancestry and raw genotypes. This migration makes that branch answer
-- for the held inviter exactly as with no grant from the adult, asking
-- private.adult_acceptance_inviter_held_v1 (unchanged) at its four checkpoints,
-- patched in place:
--
--   1. private.account_archive_complete_subjects_v1: the adult's record is not
--      listed through its grants to the inviter (a family pair, which either
--      person's own Portrait choice makes, still lists it, as it would with
--      no grant from the adult).
--   2. private.account_archive_complete_subject_authority_v1: a listed record
--      the inviter is held from has no live export permission: 'excluded',
--      'export-recipient-consent-required', no raw authority, as with none.
--   3. private.account_archive_export_recipient_v1 and
--   4. private.account_archive_raw_authority_v1: the recipient and raw
--      authorities every member page, source read, original and prepared
--      member re-asks answer not_found, as with no grant.
--
-- An archive queued, building or ready when a hold or a due reminder starts is
-- refused by the archive's own currentness rule, with nothing added here: its
-- authority receipt is the digest of the whole capture, every build call
-- recomputes the capture and refuses a different one, and readiness,
-- delivery, every manifest page and every chunk issue and acknowledgement
-- recompute it through private.export_archive_current_v1, which refuses a
-- receipt that no longer matches. A capture made while the adult's export was
-- permitted no longer matches while the inviter is held, so such an archive
-- can neither finish nor be downloaded; once the clock clears the same
-- capture is current again and it can, with no job run. The preserved
-- account export (the native archive off) reads nothing another account
-- shares: it refuses any account holding a live recipient grant, held or not,
-- and is unchanged.
--
-- Every body is patched in place under the md5-guarded convention: the exact
-- predecessor md5 and ACL, one anchor each, the successor md5 and unchanged
-- ACL, volatility and owner asserted (55000 otherwise).

do $predecessor$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.account_archive_complete_subjects_v1(jsonb)')
   and md5(pg_get_functiondef(p.oid))='43920b19954c11add72cf3a2949cdaa1' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.account_archive_complete_subject_authority_v1(jsonb,uuid,jsonb)')
   and md5(pg_get_functiondef(p.oid))='5ee7f9ac82e3bb982e213f675bdb2e43' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.account_archive_export_recipient_v1(jsonb,uuid)')
   and md5(pg_get_functiondef(p.oid))='26872ed747d7fd37b3824d61a7fa563d' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.account_archive_raw_authority_v1(jsonb,uuid)')
   and md5(pg_get_functiondef(p.oid))='13ee8d5c3055d3dd2aef841fb14060ed' and p.proacl::text='{postgres=X/postgres}')
  -- The question as 20261122110000 left it.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.adult_acceptance_inviter_held_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='bd8cde3a947a35f7ae07d24175418515' and p.proacl::text='{postgres=X/postgres}') then
  raise exception using errcode='55000',message='adult acceptance inviter archive reads prerequisite differs'; end if;
end;
$predecessor$;

do $patch_inviter_archive$
declare item record;definition text;before_acl aclitem[];before_volatile "char";before_owner oid;
begin
 for item in select * from (values
  -- The records the archive covers: not the held adult's, through its grants.
  (1,'private.account_archive_complete_subjects_v1(jsonb)','43920b19954c11add72cf3a2949cdaa1',
   'f63e4c494c07b5c2055a6570df1f4a13','{postgres=X/postgres}',
   $old$   or exists(select 1 from public.directional_grants d join public.purpose_grants g using(grant_id)
    where d.recipient_account_id=a and g.target_kind='subject' and g.target_id=s.id)
$old$,
   $new$   or (exists(select 1 from public.directional_grants d join public.purpose_grants g using(grant_id)
    where d.recipient_account_id=a and g.target_kind='subject' and g.target_id=s.id)
    -- 20261122140000 (D-156): an adult whose inviter is this account, while its
    -- acceptance hold or a due reminder stands, is not listed by their grants.
    and not private.adult_acceptance_inviter_held_v1(a,s.id))
$new$,
   'archive subjects'),
  -- A listed record: no live export permission while the inviter is held.
  (2,'private.account_archive_complete_subject_authority_v1(jsonb,uuid,jsonb)','5ee7f9ac82e3bb982e213f675bdb2e43',
   '6982e98c2b441d2e7eda98eabd5a002d','{postgres=X/postgres}',
   $old$ if s.subject_class in('self','other_adult') and exists(select 1 from public.purpose_grants g
$old$,
   $new$ -- 20261122140000 (D-156): while this account is held as the inviter of the
 -- record's adult, the record is excluded exactly as with no export permission.
 if s.subject_class in('self','other_adult') and not private.adult_acceptance_inviter_held_v1(a,s.id)
  and exists(select 1 from public.purpose_grants g
$new$,
   'archive subject authority'),
  -- The recipient authority every member page re-asks.
  (3,'private.account_archive_export_recipient_v1(jsonb,uuid)','26872ed747d7fd37b3824d61a7fa563d',
   '8ca5bc23ad2ae076b417ef39f414dd99','{postgres=X/postgres}',
   $old$ if relationship.id is null then raise exception using errcode='42501',message='not_found';end if;
$old$,
   $new$ if relationship.id is null then raise exception using errcode='42501',message='not_found';end if;
 -- 20261122140000 (D-156): as with no grant while the inviter is held.
 if private.adult_acceptance_inviter_held_v1(a,s.id) then raise exception using errcode='42501',message='not_found';end if;
$new$,
   'archive export recipient'),
  -- The raw authority every source read, original and prepared member re-asks.
  (4,'private.account_archive_raw_authority_v1(jsonb,uuid)','13ee8d5c3055d3dd2aef841fb14060ed',
   '4100fff709c7e10d486d135b5f418a6d','{postgres=X/postgres}',
   $old$ if relationship.id is null then raise exception using errcode='42501',message='not_found';end if;
$old$,
   $new$ if relationship.id is null then raise exception using errcode='42501',message='not_found';end if;
 -- 20261122140000 (D-156): as with no grant while the inviter is held.
 if private.adult_acceptance_inviter_held_v1(a,s.id) then raise exception using errcode='42501',message='not_found';end if;
$new$,
   'archive raw authority')
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
$patch_inviter_archive$;
