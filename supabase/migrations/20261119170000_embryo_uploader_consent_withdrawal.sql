-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Embryo ingest is closed in production
-- (EMBRYO_INGEST_AVAILABLE = false; every draft and cohort door is
-- TEST-LOCAL), so no non-parent upload exists there to withdraw. It follows
-- 20260930232000, whose restriction core it patches, 20260906051253, whose
-- draft purge it queues, 20261023120000, whose person-event list and nonce
-- recorder it uses, and 20261119160000.
-- =====================================================================
--
-- Withdrawing a non-parent uploader's consent for an embryo upload (owner
-- decision of 19 November 2026, "A non-parent uploader's withdrawal for an
-- embryo upload stops analysis and deletes, as they signed",
-- docs/protocol/decisions.md; design:
-- docs/evidence/consent-withdrawal-design-20261119/design.md, section 3). The
-- uploader signed "I can withdraw at any time without giving a reason.
-- Inherit then stops all analysis of these embryos and deletes what it built
-- from the files." (consent.upload-embryo v1, statement 4.)
--
-- The consent is one consent_signatures row (consent.upload-embryo, purpose
-- embryo-upload-uploader-class, target the cohort draft), which can never be
-- edited (consent_signatures_immutable). Other signature-only consents leave
-- their row as it is and are recorded by what their withdrawal does and its
-- legal audit event (a genetic parent's withdrawal is the cohort's
-- restriction and embryo.cohort.restricted), so this one is recorded the
-- same way, with its own event: embryo.upload-consent.withdrawn, a person's
-- event on api.consent-revoke attributed through the one-time consent_revoke
-- nonce, coded with the phase and the register's actor case. No table.
--
--   1. private.restrict_embryo_cohort_core_v1 gains the register's actor case
--      cohort-restriction-v1.actorCases.nonparent-required-uploader-basis-loss,
--      bound to the route api.consent-revoke and to nothing else: there the
--      actor must be the cohort's own current class-D non-parent uploader
--      principal (private.embryo_uploader_basis_loss_v1), never a member of
--      any of its participant sets, with its exact signature on the cohort's
--      draft, and the transaction's proven actor must be its account. On the
--      two existing routes the core still requires a current disposition
--      authority. No participant set changes, so the uploader gains no
--      parent role, disposition choice, claim right or say over any cohort.
--      The restriction itself is unchanged: analysis stops, derived rows and
--      source files are deleted, Record Keys and permissions end, and every
--      genetic parent in the notice set is told; its sources are deleted as
--      a withdrawal.
--   2. private.legal_audit_person_event_v1 names the new event a person's
--      event on api.consent-revoke.
--   3. public.withdraw_embryo_uploader_consent_v1, one service-only door,
--      given the uploader's own signature. After finalisation it locks the
--      cohort, spends the nonce, records the event and runs the restriction
--      under that actor case. Before finalisation it takes the invitation-
--      transition lock, locks the draft, spends the nonce, ends every pending
--      invitation of the draft (as terminalize_refused_invitation_v1 ends a
--      refused one, without its notices), cancels the draft and queues it on
--      the draft purge that a refused invitation already uses
--      (private.queue_refused_invitation_draft_v1: the jobs.retention drain
--      deletes its evidence objects, then the draft, its signatures,
--      attestations, invitations, contacts and draft principals). Nothing
--      else; another cohort or draft is never touched.
--   4. public.embryo_uploader_withdrawal_readiness_v1, the page's read:
--      'cohort' or 'draft', from the door's own predicates, or not found.

do $predecessor$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.restrict_embryo_cohort_core_v1(uuid,uuid,text)')
   and md5(pg_get_functiondef(p.oid))='f2e6cb1f392308d4c834f7eef50d7abd' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.legal_audit_person_event_v1(text,text)')
   and md5(pg_get_functiondef(p.oid))='56990e96581e5dc415222f44f09b5ac0' and p.proacl::text='{postgres=X/postgres}')
  -- The draft purge a refused invitation queues, as 20260906051253 left it.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.queue_refused_invitation_draft_v1(text,uuid,timestamptz,bigint)')
   and md5(pg_get_functiondef(p.oid))='54ab785feca9114bb097e5fbe1484dd9' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)')
   and md5(pg_get_functiondef(p.oid))='6869593d67ff37d93a6d4caea62f01c3' and p.proacl::text='{postgres=X/postgres}')
  or to_regprocedure('private.embryo_cohort_set_v1(uuid,text)') is null
  or to_regprocedure('private.lock_invitation_transitions_v1()') is null
  or to_regprocedure('private.embryo_uploader_basis_loss_v1(uuid,uuid)') is not null
  or to_regprocedure('public.withdraw_embryo_uploader_consent_v1(uuid,uuid,uuid,text,timestamptz)') is not null
  or to_regprocedure('public.embryo_uploader_withdrawal_readiness_v1(uuid,uuid)') is not null then
  raise exception using errcode='55000',message='embryo uploader withdrawal prerequisite differs'; end if;
end;
$predecessor$;

-- 1a. The actor case ----------------------------------------------------------------
-- True only for the cohort's own current class-D non-parent uploader, inside
-- the uploader's own withdrawal: the door below names the cohort in a
-- transaction-local marker just before it calls the core, and the
-- transaction's proven actor (its consumed nonce named it the legal-audit
-- actor) must be that account. The uploader's exact signature must be on the
-- cohort's draft, and the uploader must be outside every participant set.
create function private.embryo_uploader_basis_loss_v1(p_cohort_id uuid,p_principal_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_cohort_id is not null and p_principal_id is not null and exists(
  select 1 from public.embryo_cohorts c
  join public.embryo_cohort_drafts d on d.id=c.draft_id and d.owner_account_id=c.owner_account_id
   and d.upload_class='embryo_third_party' and d.upload_situation='with_genetic_parents_permission'
   and d.state='finalized' and d.uploader_principal_id=p_principal_id
  join public.subject_principals sp on sp.id=p_principal_id and sp.account_id=c.owner_account_id
   and sp.principal_kind='account_subject' and sp.status='active'
  where c.id=p_cohort_id and c.upload_class='embryo_third_party'
   and pg_catalog.current_setting('inherit.embryo_uploader_withdrawal',true)=c.id::text
   and pg_catalog.current_setting('inherit.legal_audit_actor',true)=c.owner_account_id::text
   and exists(select 1 from public.consent_signatures cs where cs.target_kind='cohort_draft' and cs.target_id=d.id
    and cs.artifact_key='consent.upload-embryo' and cs.purpose='embryo-upload-uploader-class'
    and cs.signer_principal_id=p_principal_id and cs.signer_account_id=c.owner_account_id)
   and not exists(select 1 from public.embryo_participant_sets ps where ps.cohort_id=c.id and ps.principal_id=p_principal_id)
   and not (p_principal_id=any(private.embryo_cohort_set_v1(c.id,'disposition_authorities'))));
$$;
revoke all on function private.embryo_uploader_basis_loss_v1(uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 1b and 2. Two bodies patched in place ---------------------------------------------
-- Pattern of 20261023120000: each body md5-guarded with its exact reviewed ACL,
-- one anchor each, the successor md5 and unchanged ACL asserted (55000
-- otherwise).
do $patch_uploader_withdrawal$
declare item record;definition text;before_acl aclitem[];
begin
 for item in select * from (values
  (1,'private.restrict_embryo_cohort_core_v1(uuid,uuid,text)','f2e6cb1f392308d4c834f7eef50d7abd',
   '7b821beb4dffe9d039331941b4a8d8f2','{postgres=X/postgres}',
   $old$  if p_route_id is null or p_route_id not in ('api.cohort-restrict', 'api.withdraw') then$old$,
   $new$  if p_route_id is null or p_route_id not in ('api.cohort-restrict', 'api.withdraw', 'api.consent-revoke') then$new$,
   'restriction route list'),
  (2,'private.restrict_embryo_cohort_core_v1(uuid,uuid,text)','7b821beb4dffe9d039331941b4a8d8f2',
   'ed617144a6aca603f29be372bd9bb484','{postgres=X/postgres}',
   $old$  if p_actor_principal is null or not (p_actor_principal = any (
      private.embryo_cohort_set_v1(v_cohort.id, 'disposition_authorities'))) then
    raise exception using errcode = '42501', message = 'not a disposition authority';
  end if;$old$,
   $new$  -- 20261119170000: api.consent-revoke is the register's actor case
  -- nonparent-required-uploader-basis-loss and only that case; every other
  -- route still requires a current disposition authority.
  if p_route_id = 'api.consent-revoke' then
    if not private.embryo_uploader_basis_loss_v1(v_cohort.id, p_actor_principal) then
      raise exception using errcode = '42501', message = 'not the non-parent uploader';
    end if;
  elsif p_actor_principal is null or not (p_actor_principal = any (
      private.embryo_cohort_set_v1(v_cohort.id, 'disposition_authorities'))) then
    raise exception using errcode = '42501', message = 'not a disposition authority';
  end if;$new$,
   'restriction actor case'),
  (3,'private.restrict_embryo_cohort_core_v1(uuid,uuid,text)','ed617144a6aca603f29be372bd9bb484',
   '006bfca91b8c66060681371e61333494','{postgres=X/postgres}',
   $old$  -- Both doors delete only this cohort's canonical source graph. The route
  -- has already been checked against the closed two-route list above.
  perform private.delete_embryo_cohort_sources_v1(v_cohort.id,
    case p_route_id when 'api.withdraw' then 'withdrawal' else 'restriction' end);$old$,
   $new$  -- Every door deletes only this cohort's canonical source graph. The route
  -- has already been checked against the closed route list above;
  -- 20261119170000: the non-parent uploader's withdrawal is a withdrawal.
  perform private.delete_embryo_cohort_sources_v1(v_cohort.id,
    case when p_route_id in ('api.withdraw', 'api.consent-revoke') then 'withdrawal' else 'restriction' end);$new$,
   'restriction source reason'),
  (4,'private.legal_audit_person_event_v1(text,text)','56990e96581e5dc415222f44f09b5ac0',
   '73bd0200b7e272bec503eab70499e877','{postgres=X/postgres}',
   $old$      ('api.subject-download','download.session.created')),false);$old$,
   $new$      ('api.subject-download','download.session.created'),
      -- 20261119170000: a non-parent uploader's withdrawal of its embryo upload consent.
      ('api.consent-revoke','embryo.upload-consent.withdrawn')),false);$new$,
   'person event list')
 ) as patch(ordinal,target,before_md5,after_md5,acl,old_fragment,new_fragment,label) order by ordinal loop
  select pg_get_functiondef(p.oid),p.proacl into definition,before_acl from pg_proc p
   where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.before_md5 and p.proacl::text=item.acl;
  if definition is null then raise exception using errcode='55000',message=item.label||' predecessor differs';end if;
  if (length(definition)-length(replace(definition,item.old_fragment,'')))/length(item.old_fragment)<>1 then
   raise exception using errcode='55000',message=item.label||' anchor differs';end if;
  execute replace(definition,item.old_fragment,item.new_fragment);
  if not exists(select 1 from pg_proc p where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.after_md5
    and p.proacl is not distinct from before_acl) then
   raise exception using errcode='55000',message=item.label||' successor differs';end if;
 end loop;
end;
$patch_uploader_withdrawal$;

-- 3. The door ---------------------------------------------------------------------
-- The signature never changes, so it is read first and chooses the phase.
-- After finalisation the lock order is restrict_embryo_cohort_v1's (the
-- cohort, then the nonce); before it, the draft purge's (the invitation-
-- transition lock, then the draft).
create function public.withdraw_embryo_uploader_consent_v1(p_account_id uuid,p_session_id uuid,p_signature_id uuid,
 p_nonce_hash text,p_nonce_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cs public.consent_signatures%rowtype; c public.embryo_cohorts%rowtype; d public.embryo_cohort_drafts%rowtype;
 i record; v_now timestamptz;
begin
 if p_account_id is null or p_session_id is null or p_signature_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into cs from public.consent_signatures where id=p_signature_id;
 if cs.id is null or cs.artifact_key<>'consent.upload-embryo' or cs.purpose<>'embryo-upload-uploader-class'
  or cs.target_kind<>'cohort_draft' or cs.signer_account_id is distinct from p_account_id then
  raise exception using errcode='42501',message='not_found'; end if;

 select x.* into c from public.embryo_cohorts x where x.draft_id=cs.target_id for update;
 if c.id is not null then
  -- After finalisation: the uploader's own third-party cohort, still open.
  if c.upload_class<>'embryo_third_party' or c.owner_account_id is distinct from p_account_id
   or c.status not in ('upload_pending','ingesting','active')
   or not exists(select 1 from public.embryo_cohort_drafts x where x.id=c.draft_id and x.state='finalized'
    and x.upload_class='embryo_third_party' and x.upload_situation='with_genetic_parents_permission'
    and x.owner_account_id=p_account_id and x.uploader_principal_id=cs.signer_principal_id)
   or not exists(select 1 from public.subject_principals sp where sp.id=cs.signer_principal_id
    and sp.account_id=p_account_id and sp.principal_kind='account_subject' and sp.status='active') then
   raise exception using errcode='42501',message='not_found'; end if;
  perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'consent_revoke',p_nonce_hash,p_nonce_expires_at);
  perform private.append_legal_audit_event('embryo.upload-consent.withdrawn',null,'api.consent-revoke','accepted',
   jsonb_build_object('phase','cohort','actor_case','nonparent-required-uploader-basis-loss'));
  perform pg_catalog.set_config('inherit.embryo_uploader_withdrawal',c.id::text,true);
  perform private.restrict_embryo_cohort_core_v1(c.id,cs.signer_principal_id,'api.consent-revoke');
  perform pg_catalog.set_config('inherit.embryo_uploader_withdrawal','',true);
  return jsonb_build_object('case','cohort');
 end if;

 -- Before finalisation: the uploader's own open third-party draft.
 perform private.lock_invitation_transitions_v1();
 v_now:=clock_timestamp();
 select * into d from public.embryo_cohort_drafts where id=cs.target_id for update;
 if d.id is null or exists(select 1 from public.embryo_cohorts x where x.draft_id=d.id) then
  -- Finalised since the signature was read: the page reads again.
  raise exception using errcode='55000',message='withdrawal_phase_changed'; end if;
 if d.state not in ('draft','evidence_pending','ready') or d.fixed_expires_at<=v_now
  or d.upload_class<>'embryo_third_party' or d.upload_situation<>'with_genetic_parents_permission'
  or d.owner_account_id is distinct from p_account_id or d.uploader_principal_id is distinct from cs.signer_principal_id
  or not exists(select 1 from public.subject_principals sp where sp.id=cs.signer_principal_id
   and sp.account_id=p_account_id and sp.principal_kind='account_subject' and sp.status='active') then
  raise exception using errcode='42501',message='not_found'; end if;
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'consent_revoke',p_nonce_hash,p_nonce_expires_at);
 -- Every pending invitation of this draft ends, as a refused one does, with no notice.
 for i in select x.id,x.invitee_principal_id from public.subject_invitations x
  where x.target_kind='cohort_draft' and x.target_id=d.id and x.status='pending' order by x.id for update
 loop
  update public.subject_invitations set status='cancelled',terminal_at=v_now,
   contact_purge_due_at=v_now+interval '30 days',email_encrypted=null where id=i.id;
  update public.invitation_candidates set state='refused' where invitation_id=i.id;
  update public.token_hashes th set status='revoked',ended_at=v_now from public.token_candidates tc
   where th.candidate_id=tc.id and tc.target_kind='subject_invitation' and tc.target_id=i.id
    and th.status in ('current','consumed');
  update public.rights_sessions rs set status='revoked',ended_at=v_now
   from public.token_hashes th,public.token_candidates tc
   where rs.token_hash_id=th.id and th.candidate_id=tc.id
    and tc.target_kind='subject_invitation' and tc.target_id=i.id and rs.status='active';
  delete from public.rights_nonces n using public.rights_sessions rs,public.token_hashes th,public.token_candidates tc
   where n.rights_session_id=rs.id and rs.token_hash_id=th.id and th.candidate_id=tc.id
    and tc.target_kind='subject_invitation' and tc.target_id=i.id;
  update public.token_candidates set state='invalidated' where target_kind='subject_invitation' and target_id=i.id;
  update public.mail_outbox set state='invalidated' where target_kind='subject_invitation' and target_id=i.id
   and state in ('queued','claimed') and invitation_terminal_notice_id is null;
  update public.mail_outbox m set state='invalidated' from public.invitation_reminders r
   where r.invitation_id=i.id and r.outbox_id=m.id and m.state in ('queued','claimed');
  delete from public.invitation_reminders where invitation_id=i.id;
  update public.encrypted_contact_references e set status='shredded',contact_ciphertext=null,ended_at=v_now
   from public.invitation_candidates ic where ic.invitation_id=i.id and ic.contact_reference_id=e.id
    and e.principal_id=i.invitee_principal_id;
  update public.subject_principals set status='deleted',principal_revision=principal_revision+1
   where id=i.invitee_principal_id and status='pending';
 end loop;
 update public.embryo_cohort_drafts set state='cancelled' where id=d.id;
 perform private.queue_refused_invitation_draft_v1('co_parent',d.id,d.fixed_expires_at,d.participant_set_revision);
 perform private.append_legal_audit_event('embryo.upload-consent.withdrawn',null,'api.consent-revoke','accepted',
  jsonb_build_object('phase','draft','actor_case','nonparent-required-uploader-basis-loss'));
 return jsonb_build_object('case','draft');
end $$;
revoke all on function public.withdraw_embryo_uploader_consent_v1(uuid,uuid,uuid,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.withdraw_embryo_uploader_consent_v1(uuid,uuid,uuid,text,timestamptz) to service_role;

-- 4. The page's read ------------------------------------------------------------
-- The door's predicates, in its order, without its locks: 'cohort' after
-- finalisation, 'draft' before it, anything else not found. Writes nothing.
create function public.embryo_uploader_withdrawal_readiness_v1(p_account_id uuid,p_signature_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare cs public.consent_signatures%rowtype; c public.embryo_cohorts%rowtype; d public.embryo_cohort_drafts%rowtype;
begin
 select * into cs from public.consent_signatures where id=p_signature_id;
 if cs.id is null or cs.artifact_key<>'consent.upload-embryo' or cs.purpose<>'embryo-upload-uploader-class'
  or cs.target_kind<>'cohort_draft' or cs.signer_account_id is distinct from p_account_id then
  raise exception using errcode='42501',message='not_found'; end if;
 select x.* into c from public.embryo_cohorts x where x.draft_id=cs.target_id;
 if c.id is not null then
  if c.upload_class<>'embryo_third_party' or c.owner_account_id is distinct from p_account_id
   or c.status not in ('upload_pending','ingesting','active')
   or not exists(select 1 from public.embryo_cohort_drafts x where x.id=c.draft_id and x.state='finalized'
    and x.upload_class='embryo_third_party' and x.upload_situation='with_genetic_parents_permission'
    and x.owner_account_id=p_account_id and x.uploader_principal_id=cs.signer_principal_id)
   or not exists(select 1 from public.subject_principals sp where sp.id=cs.signer_principal_id
    and sp.account_id=p_account_id and sp.principal_kind='account_subject' and sp.status='active') then
   raise exception using errcode='42501',message='not_found'; end if;
  return 'cohort';
 end if;
 select * into d from public.embryo_cohort_drafts where id=cs.target_id;
 if d.state not in ('draft','evidence_pending','ready') or d.fixed_expires_at<=clock_timestamp()
  or d.upload_class<>'embryo_third_party' or d.upload_situation<>'with_genetic_parents_permission'
  or d.owner_account_id is distinct from p_account_id or d.uploader_principal_id is distinct from cs.signer_principal_id
  or not exists(select 1 from public.subject_principals sp where sp.id=cs.signer_principal_id
   and sp.account_id=p_account_id and sp.principal_kind='account_subject' and sp.status='active') then
  raise exception using errcode='42501',message='not_found'; end if;
 return 'draft';
end $$;
revoke all on function public.embryo_uploader_withdrawal_readiness_v1(uuid,uuid)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.embryo_uploader_withdrawal_readiness_v1(uuid,uuid) to service_role;

-- Postflight: the new functions as written, the patched ones as reviewed, the
-- draft purge unchanged.
do $postflight$
begin
 if not exists(select 1 from pg_proc p where p.oid='public.withdraw_embryo_uploader_consent_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure
   and p.prosecdef and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='public.embryo_uploader_withdrawal_readiness_v1(uuid,uuid)'::regprocedure
   and p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.embryo_uploader_basis_loss_v1(uuid,uuid)'::regprocedure
   and p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.restrict_embryo_cohort_core_v1(uuid,uuid,text)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='006bfca91b8c66060681371e61333494' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.legal_audit_person_event_v1(text,text)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='73bd0200b7e272bec503eab70499e877' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.queue_refused_invitation_draft_v1(text,uuid,timestamptz,bigint)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='54ab785feca9114bb097e5fbe1484dd9' and p.proacl::text='{postgres=X/postgres}') then
  raise exception using errcode='55000',message='embryo uploader withdrawal successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
