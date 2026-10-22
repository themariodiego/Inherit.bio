-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Path B is TEST-LOCAL only: every door below rechecks
-- the test-jurisdiction flag and refuses without it.
-- =====================================================================
--
-- api.consent-revoke-rights (register; G2.1 "Build all 24"): a person who
-- confirmed a Path B request with no account turns off one purpose they
-- granted the uploader, through their adult-subject-control rights session.
--
-- CLOSED UNTIL AN ISSUER EXISTS. private.rights_session_purposes has no
-- adult-subject-control row: the no-account confirmation
-- (confirm_path_b_subject_v1) consumes its invitation session and issues no
-- control credential, and that issuer is an open owner question. So the
-- purpose trigger refuses every such session, private.rights_action_
-- permitted_v1 answers false, and this door refuses every caller with 42501.
-- No purpose is registered and no credential is issued here.
--
-- Two pieces:
--
--   * private.adult_subject_control_v1, the authority every
--     adult-subject-control door shares (withdrawal-target-v1 purposeMatrix
--     adult-subject-control; adult-subject-confirmation-v1). It locks the
--     active, unexpired session of exactly that purpose and target kind,
--     consumes its one-time nonce for the action, rechecks the purpose
--     matrix for the action and route, and locks the subject and principal
--     it names. The subject must be an active, unrestricted other_adult
--     record with no subject_account_id and a confirmed Path B draft. The
--     principal must be that subject's active non_account_subject principal
--     at the session's bound principal revision. It also resolves the
--     subject's immutable current Path B uploader account principal, the
--     only recipient. Nothing comes from a request field.
--   * public.revoke_purpose_rights_v1: one purpose, one pair. It ends only
--     the current purpose_grants + directional_grants pair whose identical
--     grant_revision and full signer, data-subject, recipient,
--     recipient-account, uploader-relationship and revision, purpose and
--     subject-binding tuple match. It then dispatches purpose-revocation-v1:
--     the recipient's exact subject-and-purpose derived rows are deleted and
--     the purpose.derived-60s purge is enqueued under the uploader's
--     account, the account that held the derived rows. An orphan, unknown,
--     already revoked, stale or mismatched pair is 42501, and nothing is
--     written. The subject's confirmation is preserved. Revoking is a right,
--     so no jurisdiction gate applies.
--
-- No existing function, table, grant or constraint is changed.

do $predecessor$
begin
 if to_regprocedure('private.rights_action_permitted_v1(text,text,text)') is null
  or to_regprocedure('private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)') is null
  or to_regprocedure('private.delete_pair_derived_rows_v1(uuid[],uuid,uuid[],text)') is null
  or to_regprocedure('private.enqueue_family_revoke_purge_v1(uuid,uuid,jsonb)') is null
  or to_regprocedure('private.lock_invitation_transitions_v1()') is null
  or to_regprocedure('private.append_legal_audit_event(text,uuid,text,text,jsonb)') is null
  or not exists(select 1 from private.rights_purpose_matrix where purpose='adult-subject-control'
   and action='revoke-purpose' and route_id='api.consent-revoke-rights') then
  raise exception using errcode='55000',message='consent revoke rights prerequisite missing'; end if;
 if to_regprocedure('private.adult_subject_control_v1(text,text,text,text,boolean)') is not null
  or to_regprocedure('public.revoke_purpose_rights_v1(text,text,text,boolean)') is not null then
  raise exception using errcode='55000',message='consent revoke rights successor already exists'; end if;
end;
$predecessor$;

create function private.adult_subject_control_v1(p_session_hash text,p_nonce text,p_action text,
 p_route_id text,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_session public.rights_sessions%rowtype;
 s public.subjects%rowtype; p public.subject_principals%rowtype; up public.subject_principals%rowtype;
begin
 if p_test_jurisdiction is distinct from true or p_session_hash is null or p_session_hash!~'^[0-9a-f]{64}$'
  or p_action is null or p_action!~'^[a-z][a-z-]{1,40}$' or p_route_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 perform private.lock_invitation_transitions_v1();
 select rs.* into v_session from public.rights_sessions rs
 where rs.session_hash=p_session_hash and rs.purpose='adult-subject-control' and rs.target_kind='subject'
  and rs.status='active' and rs.expires_at>v_now
 for update;
 if v_session.id is null then raise exception using errcode='42501',message='not_found'; end if;
 perform private.consume_embryo_operation_nonce_v1(p_nonce,null,null,
  'adult_subject_control_'||replace(p_action,'-','_'),'rights_session',v_session.id);
 if not private.rights_action_permitted_v1(v_session.purpose,p_action,p_route_id) then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into s from public.subjects where id=v_session.target_id for update;
 if s.id is null or s.subject_class<>'other_adult' or s.lifecycle<>'active' or s.subject_account_id is not null
  or s.owner_account_id is null
  or not exists(select 1 from public.adult_subject_drafts d where d.subject_id=s.id and d.state='confirmed'
   and d.adult_flow in ('path-b-subject-esignature','path-b-reviewed-document')) then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into p from public.subject_principals where id=v_session.principal_id and subject_id=s.id
  and principal_kind='non_account_subject' and status='active' and account_id is null
  and principal_revision=v_session.authority_revision
 for update;
 if p.id is null then raise exception using errcode='42501',message='not_found'; end if;
 -- The uploader's own account principal: the one recipient this person can name.
 select sp.* into up from public.subject_principals sp join public.subjects us on us.id=sp.subject_id
 where sp.account_id=s.owner_account_id and sp.principal_kind='account_subject' and sp.status='active'
  and us.subject_class='self' and us.subject_account_id=s.owner_account_id and us.lifecycle='active'
 order by sp.created_at limit 1;
 return jsonb_build_object('sessionId',v_session.id,'subjectId',s.id,
  'subjectBindingRevision',s.subject_binding_revision,'principalId',p.id,'principalRevision',p.principal_revision,
  'uploaderAccountId',s.owner_account_id,'uploaderPrincipalId',up.id);
end $$;
revoke all on function private.adult_subject_control_v1(text,text,text,text,boolean)
 from public,anon,authenticated,inherit_upload_only,service_role;

create function public.revoke_purpose_rights_v1(p_session_hash text,p_nonce text,p_purpose text,
 p_test_jurisdiction boolean)
returns text language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare v_now timestamptz:=clock_timestamp(); c jsonb; g record; v_counts jsonb;
begin
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry','copilot.local') then
  raise exception using errcode='42501',message='not_found'; end if;
 c:=private.adult_subject_control_v1(p_session_hash,p_nonce,'revoke-purpose','api.consent-revoke-rights',
  p_test_jurisdiction);
 if c->>'uploaderPrincipalId' is null then raise exception using errcode='42501',message='not_found'; end if;
 select pg.grant_id,pg.grant_revision,pg.target_id,dg.recipient_account_id into g
 from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 join public.subject_relationships r on r.id=dg.relationship_id
 where pg.target_kind='subject' and pg.target_id=(c->>'subjectId')::uuid and pg.purpose=p_purpose
  and pg.signer_principal_id=(c->>'principalId')::uuid and pg.data_subject_principal_id=pg.signer_principal_id
  and pg.subject_binding_revision=(c->>'subjectBindingRevision')::bigint and pg.revoked_at is null
  and dg.status='current' and dg.direction='subject_to_recipient'
  and dg.recipient_principal_id=(c->>'uploaderPrincipalId')::uuid
  and dg.recipient_account_id=(c->>'uploaderAccountId')::uuid
  and r.relationship_kind='uploader' and r.status='current' and r.subject_id=pg.target_id
  and r.data_subject_principal_id=pg.signer_principal_id and r.recipient_principal_id=dg.recipient_principal_id
  and r.recipient_account_id is not distinct from dg.recipient_account_id
  and dg.relationship_or_pair_revision=r.relationship_revision
 for update of pg,dg,r;
 if g.grant_id is null then raise exception using errcode='42501',message='not_found'; end if;
 update public.purpose_grants set revoked_at=v_now,revocation_reason='withdrawn'
  where grant_id=g.grant_id and grant_revision=g.grant_revision;
 update public.directional_grants set status='revoked',ended_at=v_now
  where grant_id=g.grant_id and grant_revision=g.grant_revision;
 v_counts:=private.delete_pair_derived_rows_v1('{}'::uuid[],g.recipient_account_id,array[g.target_id],p_purpose);
 perform private.enqueue_family_revoke_purge_v1(g.recipient_account_id,g.grant_id,
  jsonb_build_object('disposition','purpose-revocation','purpose',p_purpose,'grant_id',g.grant_id,
   'pair_ids','[]'::jsonb));
 perform private.append_legal_audit_event('purpose.revoked',null,'api.consent-revoke-rights','accepted',
  jsonb_build_object('purpose',p_purpose,'revision',g.grant_revision,'deleted',v_counts));
 return 'accepted';
end $$;
revoke all on function public.revoke_purpose_rights_v1(text,text,text,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.revoke_purpose_rights_v1(text,text,text,boolean) to service_role;

notify pgrst, 'reload schema';
