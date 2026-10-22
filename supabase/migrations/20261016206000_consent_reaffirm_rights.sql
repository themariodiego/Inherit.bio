-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Path B is TEST-LOCAL only: the door below rechecks the
-- test-jurisdiction flag and refuses without it.
-- =====================================================================
--
-- api.consent-reaffirm-rights (register; G2.1 "Build all 24"; owner decision
-- 2026-10-22, "Reaffirmation"): the no-account twin of api.consent-reaffirm.
-- A person who confirmed a Path B request with no account signs the current
-- version of consent.share-with-adult for the uploader-direction grant they
-- signed before, through a consent-reaffirm rights session bound to that
-- exact prior grant and revision.
--
-- BUILT CLOSED. private.rights_session_purposes has no consent-reaffirm row:
-- the credential that would carry the person to this session is a mailed
-- notice whose wording is not approved, so its issuer is not built. The
-- purpose trigger therefore refuses every such session, the purpose matrix
-- answers false and this door refuses every caller with 42501. Nothing here
-- registers the purpose, issues a credential or sends mail.
--
-- public.reaffirm_purpose_rights_v1, in one transaction, once a session can
-- exist:
--   1. the TEST flag; the active, unexpired consent-reaffirm session of
--      target kind purpose_grant is locked, its one-time nonce consumed for
--      the action, and the purpose matrix rechecked for api.consent-reaffirm-
--      rights;
--   2. the prior pair the session names is locked at the session's bound
--      revision. Its signer is the session principal, an active non-account
--      principal that signed with no account and is its own data subject, of
--      an active other_adult subject with no account and a confirmed Path B
--      draft. Its recipient is that subject's immutable current uploader,
--      over a current uploader relationship at the bound revision. Its text
--      has been superseded by a current version of the same key;
--   3. the presentation the rights page minted must name exactly that prior
--      pair, revision, principal, uploader, relationship, subject binding,
--      purpose and current text; its own nonce is consumed too;
--   4. other-adult-mitigation-state-v1 must allow at purpose-grant-create;
--   5. the statements are exact, the typed name present as ciphertext (the
--      prior signature is Tier 2) and the person's own code well formed. The
--      register's jurisdictionAttestationVersion/Hash are not taken:
--      docs/route-divergence.json records this route as serving
--      jurisdictionCode (owner decisions 2026-09-13 and 2026-10-16, D-083);
--   6. the prior pair is superseded and one new signature, purpose_grants
--      and directional_grants row are written with one identical new grant
--      revision, the prior revision plus one, over the same relationship;
--      the rights session is consumed; one audit event.
--
-- No existing function, table, grant or constraint is changed.

do $predecessor$
begin
 if to_regprocedure('private.rights_action_permitted_v1(text,text,text)') is null
  or to_regprocedure('private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)') is null
  or to_regprocedure('private.other_adult_mitigation_v1(uuid,uuid,text)') is null
  or to_regprocedure('private.lock_invitation_transitions_v1()') is null
  or to_regprocedure('private.append_legal_audit_event(text,uuid,text,text,jsonb)') is null
  or not exists(select 1 from private.rights_purpose_matrix where purpose='consent-reaffirm'
   and action='reaffirm' and route_id='api.consent-reaffirm-rights') then
  raise exception using errcode='55000',message='consent reaffirm rights prerequisite missing'; end if;
 if exists(select 1 from private.rights_session_purposes where session_purpose='consent-reaffirm') then
  raise exception using errcode='55000',message='consent reaffirm rights issuer unexpectedly registered'; end if;
 if to_regprocedure('public.reaffirm_purpose_rights_v1(text,text,jsonb,text[],bytea,text,boolean)') is not null then
  raise exception using errcode='55000',message='consent reaffirm rights successor already exists'; end if;
end;
$predecessor$;

create function public.reaffirm_purpose_rights_v1(p_session_hash text,p_nonce text,p_presentation jsonb,
 p_statement_keys text[],p_signing_name_ciphertext bytea,p_jurisdiction_code text,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare v_now timestamptz:=clock_timestamp(); v_session public.rights_sessions%rowtype; g record; up uuid;
 a public.consent_artifacts%rowtype; m jsonb; v_signature uuid; v_grant uuid; v_revision bigint;
begin
 if p_test_jurisdiction is distinct from true or p_session_hash is null or p_session_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_presentation is null or jsonb_typeof(p_presentation) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p_presentation))<>12
  or not (p_presentation ?& array['priorGrantId','priorRevision','principalId','uploaderPrincipalId','uploaderAccountId',
   'relationshipId','relationshipRevision','subjectBindingRevision','purpose','artifactVersion','artifactBodySha256','nonce']) then
  raise exception using errcode='42501',message='not_found'; end if;
 perform private.lock_invitation_transitions_v1();
 select rs.* into v_session from public.rights_sessions rs
 where rs.session_hash=p_session_hash and rs.purpose='consent-reaffirm' and rs.target_kind='purpose_grant'
  and rs.status='active' and rs.expires_at>v_now
 for update;
 if v_session.id is null then raise exception using errcode='42501',message='not_found'; end if;
 perform private.consume_embryo_operation_nonce_v1(p_nonce,null,null,'consent_reaffirm','rights_session',v_session.id);
 if not private.rights_action_permitted_v1(v_session.purpose,'reaffirm','api.consent-reaffirm-rights') then
  raise exception using errcode='42501',message='not_found'; end if;

 select pg.grant_id,pg.grant_revision,pg.target_id,pg.purpose,pg.artifact_key,pg.artifact_version,
  pg.subject_binding_revision,dg.recipient_principal_id,dg.recipient_account_id,dg.relationship_id,
  dg.relationship_or_pair_revision,s.owner_account_id,s.subject_binding_revision as current_binding into g
 from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 join public.consent_signatures cs on cs.id=pg.signature_id and cs.signer_principal_id=pg.signer_principal_id
 join public.subject_principals p on p.id=pg.signer_principal_id
 join public.subjects s on s.id=pg.target_id
 join public.subject_relationships r on r.id=dg.relationship_id
 where pg.grant_id=v_session.target_id and pg.grant_revision=v_session.authority_revision
  and pg.target_kind='subject' and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>v_now)
  and pg.signer_principal_id=v_session.principal_id and pg.data_subject_principal_id=pg.signer_principal_id
  and pg.purpose in ('reports.monogenic','reports.polygenic','ancestry')
  and pg.artifact_key='consent.share-with-adult' and pg.subject_binding_revision=s.subject_binding_revision
  and cs.signer_account_id is null and cs.signing_name_encrypted is not null
  and p.principal_kind='non_account_subject' and p.status='active' and p.account_id is null and p.subject_id=s.id
  and s.subject_class='other_adult' and s.lifecycle='active' and s.subject_account_id is null and s.owner_account_id is not null
  and exists(select 1 from public.adult_subject_drafts d where d.subject_id=s.id and d.state='confirmed'
   and d.adult_flow in ('path-b-subject-esignature','path-b-reviewed-document'))
  and dg.status='current' and dg.direction='subject_to_recipient' and dg.recipient_account_id=s.owner_account_id
  and r.relationship_kind='uploader' and r.status='current' and r.subject_id=s.id
  and r.data_subject_principal_id=pg.signer_principal_id and r.recipient_principal_id=dg.recipient_principal_id
  and r.recipient_account_id is not distinct from dg.recipient_account_id
  and dg.relationship_or_pair_revision=r.relationship_revision
 for update of pg,dg,r,s;
 if g.grant_id is null then raise exception using errcode='42501',message='not_found'; end if;
 -- The recipient must still be the subject's own uploader account principal.
 select sp.id into up from public.subject_principals sp join public.subjects us on us.id=sp.subject_id
 where sp.account_id=g.owner_account_id and sp.principal_kind='account_subject' and sp.status='active'
  and us.subject_class='self' and us.subject_account_id=g.owner_account_id and us.lifecycle='active'
 order by sp.created_at limit 1;
 if up is distinct from g.recipient_principal_id then raise exception using errcode='42501',message='not_found'; end if;
 if not exists(select 1 from public.consent_artifacts pa where pa.artifact_key=g.artifact_key
   and pa.version=g.artifact_version and pa.superseded_at is not null) then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into a from public.consent_artifacts ca where ca.artifact_key=g.artifact_key
  and ca.version=(p_presentation->>'artifactVersion')::integer and ca.version>g.artifact_version
  and ca.body_sha256=p_presentation->>'artifactBodySha256' and ca.superseded_at is null and ca.published_at<=v_now
  and ca.effective_on<=timezone('UTC',v_now)::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex') for share;
 if a.artifact_key is null then raise exception using errcode='42501',message='not_found'; end if;
 if (p_presentation->>'priorGrantId',p_presentation->>'priorRevision',p_presentation->>'principalId',
     p_presentation->>'uploaderPrincipalId',p_presentation->>'uploaderAccountId',p_presentation->>'relationshipId',
     p_presentation->>'relationshipRevision',p_presentation->>'subjectBindingRevision',p_presentation->>'purpose')
  is distinct from (g.grant_id::text,g.grant_revision::text,v_session.principal_id::text,g.recipient_principal_id::text,
     g.recipient_account_id::text,g.relationship_id::text,g.relationship_or_pair_revision::text,g.current_binding::text,g.purpose) then
  raise exception using errcode='42501',message='not_found'; end if;
 perform private.consume_embryo_operation_nonce_v1(p_presentation->>'nonce',null,null,'reaffirm_presentation',
  'rights_session',v_session.id);

 -- other-adult-mitigation-state-v1 at purpose-grant-create, for the uploader.
 m:=private.other_adult_mitigation_v1(g.target_id,g.recipient_account_id,'purpose-grant-create');
 if m->>'decision' is distinct from 'allow' then raise exception using errcode='42501',message='not_found'; end if;
 if p_statement_keys is distinct from array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time']
  or p_signing_name_ciphertext is null or octet_length(p_signing_name_ciphertext)<16
  or p_jurisdiction_code is null or p_jurisdiction_code!~'^[A-Z]{2}$' then
  raise exception using errcode='42501',message='not_found'; end if;

 update public.purpose_grants set revoked_at=v_now,revocation_reason='superseded'
  where grant_id=g.grant_id and grant_revision=g.grant_revision;
 update public.directional_grants set status='superseded',ended_at=v_now
  where grant_id=g.grant_id and grant_revision=g.grant_revision;
 v_revision:=g.grant_revision+1;
 insert into public.consent_signatures(artifact_key,artifact_version,artifact_body_sha256,signer_principal_id,
  signer_account_id,target_kind,target_id,purpose,statement_keys,signing_name_encrypted,jurisdiction_code,
  jurisdiction_revision,subject_binding_revision)
 values(a.artifact_key,a.version,a.body_sha256,v_session.principal_id,null,'subject',g.target_id,g.purpose,
  p_statement_keys,p_signing_name_ciphertext,p_jurisdiction_code,1,g.current_binding)
 returning id into v_signature;
 insert into public.purpose_grants(grant_revision,target_kind,target_id,purpose,artifact_key,artifact_version,
  artifact_body_sha256,signature_id,signer_principal_id,data_subject_principal_id,subject_binding_revision,
  jurisdiction_code,jurisdiction_revision)
 values(v_revision,'subject',g.target_id,g.purpose,a.artifact_key,a.version,a.body_sha256,v_signature,
  v_session.principal_id,v_session.principal_id,g.current_binding,p_jurisdiction_code,1)
 returning grant_id into v_grant;
 insert into public.directional_grants(grant_id,grant_revision,recipient_principal_id,recipient_account_id,
  relationship_id,relationship_or_pair_revision,direction)
 values(v_grant,v_revision,g.recipient_principal_id,g.recipient_account_id,g.relationship_id,
  g.relationship_or_pair_revision,'subject_to_recipient');
 -- The session authorized this one prior revision; it ends with it.
 update public.rights_sessions set status='consumed',ended_at=v_now where id=v_session.id;
 perform private.append_legal_audit_event('purpose.reaffirmed',null,'api.consent-reaffirm-rights','accepted',
  jsonb_build_object('purpose',g.purpose,'direction','uploader','revision',v_revision,'artifact_version',a.version));
 return jsonb_build_object('recordKind','purpose_grant','recordId',v_grant,'artifactKey',a.artifact_key,
  'artifactVersion',a.version,'purposeKey',g.purpose,'signedAt',v_now);
end $$;
revoke all on function public.reaffirm_purpose_rights_v1(text,text,jsonb,text[],bytea,text,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.reaffirm_purpose_rights_v1(text,text,jsonb,text[],bytea,text,boolean)
 to service_role;

notify pgrst, 'reload schema';
