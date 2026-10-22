-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Every grant it re-runs keeps its own gates: the Path B
-- branch refuses without the test-jurisdiction flag, and no restricted
-- capability is opened here.
-- =====================================================================
--
-- api.consent-reaffirm (register; G2.1 "Build all 24"; owner decision
-- 2026-10-22, "Reaffirmation"): a signed-in person signs the current version
-- of a consent text they signed before, for the same purpose grant.
--
-- Offered only when the prior row's artifact version has been superseded by
-- a current version of the same key. It covers two kinds of prior row, each
-- re-run through the grant function that wrote it:
--
--   * own-subject self grants: consent.own-monogenic, -polygenic and
--     -ancestry on the account's own self record (grant_own_report_purpose_v1),
--     and on an adult record bound to the account under Path B
--     (grant_path_b_purpose_v1, TEST-LOCAL);
--   * adult directional grants under consent.share-with-adult: to a family
--     member (grant_family_ancestry_purpose_v1, grant_family_report_purpose_v1,
--     grant_family_portrait_purpose_v1, grant_health_picture_purpose_v1 or
--     grant_directional_purpose_v1, exactly as api.consents dispatches them),
--     and from a Path B person with an account to their uploader
--     (grant_path_b_purpose_v1, which reruns other-adult-mitigation-state-v1).
--
-- Every other prior row is opaque not-found: a donor-attribution signature
-- (consent.embryo-donor-attribution) or any other artifact signature, an
-- embryo cohort grant, an own Copilot grant, a Tier-2 typed-name signature,
-- a row whose signer is not this account's own data subject, a stale or
-- revoked row, and a row whose text has not been superseded.
--
-- Pieces:
--   * private.consent_reaffirm_offer_v1(account, session, prior grant): the
--     exact binding a presentation must carry, or null when nothing is
--     offered. It names the prior pair and revision, the purpose, direction,
--     signer, recipient, relationship or pair and its revision, the subject
--     binding and jurisdiction revisions, the current artifact version and
--     body hash, the prior signature's statement keys, and the grant
--     function's own context (the own-report context, the Path B person) or
--     endpoint receipt (family). public.consent_reaffirm_offer_v1 serves it
--     to the service role, for the presentation token.
--   * public.reaffirm_purpose_grant_v1: in one transaction it recomputes the
--     offer and requires it to equal the presented one exactly, locks the
--     prior pair, terminalizes it as superseded, re-runs the grant function
--     that wrote it with the presentation's single-use nonce, and gives the
--     new pair one identical grant revision, the prior revision plus one.
--     Access has no gap: both happen before commit. Any mismatch writes
--     nothing.
--
-- No existing function, table, grant or constraint is changed.

do $predecessor$
begin
 if to_regprocedure('public.grant_own_report_purpose_v1(uuid,uuid,uuid,jsonb,text,integer,text,text,timestamptz)') is null
  or to_regprocedure('public.own_report_context_v1(uuid,uuid,uuid)') is null
  or to_regprocedure('private.grant_path_b_purpose_v1(uuid,uuid,uuid,text,text,integer,text,text,timestamptz,boolean)') is null
  or to_regprocedure('private.path_b_person_v1(uuid,uuid,uuid)') is null
  or to_regprocedure('public.grant_directional_purpose_v1(uuid,uuid,uuid,text,text,integer,text)') is null
  or to_regprocedure('public.grant_family_ancestry_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text)') is null
  or to_regprocedure('public.grant_family_report_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text)') is null
  or to_regprocedure('public.grant_family_portrait_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text)') is null
  or to_regprocedure('public.grant_health_picture_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text)') is null
  or to_regprocedure('private.family_report_endpoints_v1(uuid,uuid,uuid,boolean)') is null
  or to_regprocedure('public.family_portrait_grant_presentation_v1(uuid,uuid,uuid,uuid)') is null
  or to_regclass('private.family_ancestry_grant_snapshots') is null
  or to_regprocedure('private.append_legal_audit_event(text,uuid,text,text,jsonb)') is null then
  raise exception using errcode='55000',message='consent reaffirm prerequisite missing'; end if;
 if to_regprocedure('private.consent_reaffirm_offer_v1(uuid,uuid,uuid)') is not null
  or to_regprocedure('public.consent_reaffirm_offer_v1(uuid,uuid,uuid)') is not null
  or to_regprocedure('public.reaffirm_purpose_grant_v1(uuid,uuid,uuid,jsonb,text,timestamptz,boolean)') is not null then
  raise exception using errcode='55000',message='consent reaffirm successor already exists'; end if;
end;
$predecessor$;

create function private.consent_reaffirm_offer_v1(p_account_id uuid,p_session_id uuid,p_prior_grant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); g record; a public.consent_artifacts%rowtype;
 v_kind text; v_function text; v_path_b_direction text; v_context jsonb; v_receipt text;
begin
 if p_account_id is null or p_session_id is null or p_prior_grant_id is null then return null; end if;
 select pg.grant_id,pg.grant_revision,pg.target_kind,pg.target_id,pg.purpose,pg.artifact_key,pg.artifact_version,
  pg.signer_principal_id,pg.data_subject_principal_id,pg.subject_binding_revision,pg.jurisdiction_revision,
  pg.copilot_recipient_revision,pg.path_b_originating_session_id,
  dg.direction,dg.recipient_principal_id,dg.recipient_account_id,dg.relationship_id,dg.pair_id,
  dg.relationship_or_pair_revision,cs.statement_keys,cs.signing_name_encrypted,cs.signer_account_id,
  s.subject_class,s.subject_account_id,s.lifecycle,r.relationship_kind,r.status as relationship_status,
  r.relationship_revision,sp.account_id as signer_account,sp.status as signer_status
 into g
 from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 join public.consent_signatures cs on cs.id=pg.signature_id and cs.signer_principal_id=pg.signer_principal_id
 join public.subject_principals sp on sp.id=pg.signer_principal_id
 join public.subjects s on s.id=pg.target_id and pg.target_kind='subject'
 left join public.subject_relationships r on r.id=dg.relationship_id
 where pg.grant_id=p_prior_grant_id and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>v_now)
  and dg.status='current';
 if g.grant_id is null or g.signer_account is distinct from p_account_id or g.signer_status<>'active'
  or g.signer_account_id is distinct from p_account_id
  or g.data_subject_principal_id<>g.signer_principal_id or g.subject_account_id is distinct from p_account_id
  or g.lifecycle<>'active' or g.copilot_recipient_revision is not null or g.signing_name_encrypted is not null
  or g.statement_keys is null or cardinality(g.statement_keys)=0 then
  return null; end if;
 -- Offered only when the signed text has been superseded by a current
 -- version of the same key.
 if not exists(select 1 from public.consent_artifacts pa where pa.artifact_key=g.artifact_key
   and pa.version=g.artifact_version and pa.superseded_at is not null) then return null; end if;
 select * into a from public.consent_artifacts ca where ca.artifact_key=g.artifact_key and ca.version>g.artifact_version
  and ca.superseded_at is null and ca.published_at<=v_now and ca.effective_on<=timezone('UTC',v_now)::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 order by ca.version desc limit 1;
 if a.artifact_key is null then return null; end if;

 begin
  if g.direction='self' and g.artifact_key in ('consent.own-monogenic','consent.own-polygenic','consent.own-ancestry')
   and g.purpose in ('reports.monogenic','reports.polygenic','ancestry') and g.relationship_id is null and g.pair_id is null then
   if g.subject_class='self' then
    v_kind:='own-report'; v_function:='grant_own_report_purpose_v1';
    v_context:=public.own_report_context_v1(p_account_id,p_session_id,g.target_id);
   elsif g.subject_class='other_adult' then
    v_kind:='path-b'; v_function:='grant_path_b_purpose_v1'; v_path_b_direction:='self';
    v_context:=private.path_b_person_v1(p_account_id,p_session_id,g.target_id);
   else return null; end if;
  elsif g.direction='subject_to_recipient' and g.artifact_key='consent.share-with-adult' then
   if g.relationship_kind='uploader' and g.relationship_status='current' and g.subject_class='other_adult'
    and g.purpose in ('reports.monogenic','reports.polygenic','ancestry')
    and g.relationship_revision=g.relationship_or_pair_revision then
    v_kind:='path-b'; v_function:='grant_path_b_purpose_v1'; v_path_b_direction:='uploader';
    v_context:=private.path_b_person_v1(p_account_id,p_session_id,g.target_id);
   elsif ((g.relationship_kind='family_member' and g.relationship_status='current'
     and g.relationship_revision=g.relationship_or_pair_revision) or (g.pair_id is not null and g.purpose='family.portrait'))
    and g.recipient_account_id is not null and g.subject_class in ('self','other_adult') then
    v_kind:='family';
    v_function:=case g.purpose when 'ancestry' then 'grant_family_ancestry_purpose_v1'
     when 'reports.monogenic' then 'grant_family_report_purpose_v1' when 'reports.polygenic' then 'grant_family_report_purpose_v1'
     when 'family.portrait' then 'grant_family_portrait_purpose_v1' when 'family.heritability' then 'grant_health_picture_purpose_v1'
     when 'copilot.local' then 'grant_directional_purpose_v1' when 'export.share-link' then 'grant_directional_purpose_v1'
     when 'raw.export' then 'grant_directional_purpose_v1' when 'raw.browse' then 'grant_directional_purpose_v1' end;
    if v_function is null then return null; end if;
    if g.purpose='family.portrait' then
     v_receipt:=public.family_portrait_grant_presentation_v1(p_account_id,p_session_id,g.target_id,g.recipient_account_id);
    elsif v_function<>'grant_directional_purpose_v1' then
     v_receipt:=encode(extensions.digest(convert_to(
      private.family_report_endpoints_v1(p_account_id,g.target_id,g.recipient_account_id)::text,'UTF8'),'sha256'),'hex');
    end if;
    if v_function<>'grant_directional_purpose_v1' and (v_receipt is null or v_receipt!~'^[0-9a-f]{64}$') then return null; end if;
   else return null; end if;
  else return null; end if;
 exception when others then return null;
 end;
 if v_context is null and v_kind<>'family' then return null; end if;

 return jsonb_build_object('kind',v_kind,'grantFunction',v_function,'priorGrantId',g.grant_id,
  'priorRevision',g.grant_revision,'priorArtifactVersion',g.artifact_version,'purpose',g.purpose,
  'direction',g.direction,'pathBDirection',v_path_b_direction,'subjectId',g.target_id,
  'signerPrincipalId',g.signer_principal_id,'recipientPrincipalId',g.recipient_principal_id,
  'recipientAccountId',g.recipient_account_id,'relationshipId',g.relationship_id,'pairId',g.pair_id,
  'relationshipOrPairRevision',g.relationship_or_pair_revision,'subjectBindingRevision',g.subject_binding_revision,
  'jurisdictionRevision',g.jurisdiction_revision,'artifactKey',a.artifact_key,'artifactVersion',a.version,
  'artifactBodySha256',a.body_sha256,'statementKeys',to_jsonb(g.statement_keys),'context',v_context,
  'endpointReceipt',v_receipt);
end $$;
revoke all on function private.consent_reaffirm_offer_v1(uuid,uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

create function public.consent_reaffirm_offer_v1(p_account_id uuid,p_session_id uuid,p_prior_grant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='not_found'; end if;
 return private.consent_reaffirm_offer_v1(p_account_id,p_session_id,p_prior_grant_id);
end $$;
revoke all on function public.consent_reaffirm_offer_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.consent_reaffirm_offer_v1(uuid,uuid,uuid) to service_role;

create function public.reaffirm_purpose_grant_v1(p_account_id uuid,p_session_id uuid,p_prior_grant_id uuid,
 p_offer jsonb,p_nonce text,p_expires_at timestamptz,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare v_now timestamptz:=clock_timestamp(); o jsonb; v_prior record; v_result jsonb; v_grant uuid;
 v_new record; v_revision bigint; v_nonce_hash text; v_snapshot jsonb;
begin
 if p_account_id is null or p_session_id is null or p_prior_grant_id is null
  or p_offer is null or jsonb_typeof(p_offer) is distinct from 'object'
  or p_nonce is null or char_length(p_nonce) not between 16 and 256 or p_nonce~'\s'
  or p_expires_at is null or p_expires_at<=v_now or p_expires_at>v_now+interval '10 minutes' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 -- The acting account first, as every grant function locks it.
 perform 1 from public.profiles where id=p_account_id for update;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select pg.grant_id,pg.grant_revision into v_prior from public.purpose_grants pg
  join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 where pg.grant_id=p_prior_grant_id and pg.revoked_at is null and dg.status='current'
 for update of pg,dg;
 if v_prior.grant_id is null then raise exception using errcode='42501',message='not_found'; end if;
 o:=private.consent_reaffirm_offer_v1(p_account_id,p_session_id,p_prior_grant_id);
 if o is null or o is distinct from p_offer or (o->>'priorRevision')::bigint<>v_prior.grant_revision then
  raise exception using errcode='42501',message='not_found'; end if;
 if o->>'kind'='path-b' and p_test_jurisdiction is distinct from true then
  raise exception using errcode='42501',message='not_found'; end if;

 -- Terminalize the prior pair in this same transaction. The grant function
 -- below writes its successor before commit, so access has no gap.
 update public.purpose_grants set revoked_at=v_now,revocation_reason='superseded'
  where grant_id=v_prior.grant_id and grant_revision=v_prior.grant_revision;
 update public.directional_grants set status='superseded',ended_at=v_now
  where grant_id=v_prior.grant_id and grant_revision=v_prior.grant_revision;

 v_nonce_hash:=encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex');
 case o->>'grantFunction'
  when 'grant_own_report_purpose_v1' then
   v_result:=public.grant_own_report_purpose_v1(p_account_id,p_session_id,(o->>'subjectId')::uuid,o->'context',
    o->>'purpose',(o->>'artifactVersion')::integer,o->>'artifactBodySha256',v_nonce_hash,p_expires_at);
   v_grant:=(v_result->>'recordId')::uuid;
  when 'grant_path_b_purpose_v1' then
   v_result:=private.grant_path_b_purpose_v1(p_account_id,p_session_id,(o->>'subjectId')::uuid,o->>'purpose',
    o->>'pathBDirection',(o->>'artifactVersion')::integer,o->>'artifactBodySha256',v_nonce_hash,p_expires_at,
    p_test_jurisdiction);
   v_grant:=(v_result->>'recordId')::uuid;
  when 'grant_family_ancestry_purpose_v1' then
   v_grant:=public.grant_family_ancestry_purpose_v1(p_account_id,p_session_id,(o->>'subjectId')::uuid,
    (o->>'recipientPrincipalId')::uuid,(o->>'recipientAccountId')::uuid,o->>'purpose',(o->>'artifactVersion')::integer,
    o->>'artifactBodySha256',p_nonce,o->>'endpointReceipt');
  when 'grant_family_report_purpose_v1' then
   v_grant:=public.grant_family_report_purpose_v1(p_account_id,p_session_id,(o->>'subjectId')::uuid,
    (o->>'recipientPrincipalId')::uuid,(o->>'recipientAccountId')::uuid,o->>'purpose',(o->>'artifactVersion')::integer,
    o->>'artifactBodySha256',p_nonce,o->>'endpointReceipt');
  when 'grant_family_portrait_purpose_v1' then
   v_grant:=public.grant_family_portrait_purpose_v1(p_account_id,p_session_id,(o->>'subjectId')::uuid,
    (o->>'recipientPrincipalId')::uuid,(o->>'recipientAccountId')::uuid,o->>'purpose',(o->>'artifactVersion')::integer,
    o->>'artifactBodySha256',p_nonce,o->>'endpointReceipt');
  when 'grant_health_picture_purpose_v1' then
   v_grant:=public.grant_health_picture_purpose_v1(p_account_id,p_session_id,(o->>'subjectId')::uuid,
    (o->>'recipientPrincipalId')::uuid,(o->>'recipientAccountId')::uuid,o->>'purpose',(o->>'artifactVersion')::integer,
    o->>'artifactBodySha256',p_nonce,o->>'endpointReceipt');
  when 'grant_directional_purpose_v1' then
   v_grant:=public.grant_directional_purpose_v1(p_account_id,(o->>'subjectId')::uuid,(o->>'recipientPrincipalId')::uuid,
    o->>'purpose','consent.share-with-adult',(o->>'artifactVersion')::integer,p_nonce);
  else raise exception using errcode='42501',message='not_found';
 end case;

 -- The successor must be a fresh current pair of the identical endpoints,
 -- under the current text.
 select pg.grant_id,pg.grant_revision,pg.purpose,pg.target_id,pg.signer_principal_id,pg.artifact_key,pg.artifact_version,
  pg.artifact_body_sha256,pg.granted_at,dg.direction,dg.recipient_principal_id,dg.recipient_account_id
 into v_new from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 where pg.grant_id=v_grant and pg.revoked_at is null and dg.status='current' for update of pg,dg;
 if v_new.grant_id is null or v_new.grant_id=v_prior.grant_id or v_new.grant_revision<>1
  or (v_new.purpose,v_new.target_id,v_new.signer_principal_id,v_new.direction,v_new.recipient_principal_id,
      v_new.recipient_account_id::text,v_new.artifact_key,v_new.artifact_version,v_new.artifact_body_sha256)
   is distinct from (o->>'purpose',(o->>'subjectId')::uuid,(o->>'signerPrincipalId')::uuid,o->>'direction',
      (o->>'recipientPrincipalId')::uuid,o->>'recipientAccountId',o->>'artifactKey',(o->>'artifactVersion')::integer,
      o->>'artifactBodySha256') then
  raise exception using errcode='42501',message='not_found'; end if;

 -- One identical new grant revision on both rows of the pair. The family
 -- ancestry snapshot is cleared by its own trigger on a revision change, so it
 -- is carried across unchanged.
 v_revision:=v_prior.grant_revision+1;
 select to_jsonb(fs) into v_snapshot from private.family_ancestry_grant_snapshots fs where fs.grant_id=v_new.grant_id;
 update public.purpose_grants set grant_revision=v_revision where grant_id=v_new.grant_id;
 update public.directional_grants set grant_revision=v_revision where grant_id=v_new.grant_id;
 if v_snapshot is not null then
  insert into private.family_ancestry_grant_snapshots
  select * from jsonb_populate_record(null::private.family_ancestry_grant_snapshots,v_snapshot);
 end if;

 perform private.append_legal_audit_event('purpose.reaffirmed',null,'api.consent-reaffirm','accepted',
  jsonb_build_object('purpose',v_new.purpose,'direction',v_new.direction,'revision',v_revision,
   'artifact_version',v_new.artifact_version));
 return jsonb_build_object('recordKind','purpose_grant','recordId',v_new.grant_id,'artifactKey',v_new.artifact_key,
  'artifactVersion',v_new.artifact_version,'purposeKey',v_new.purpose,'signedAt',v_new.granted_at);
end $$;
revoke all on function public.reaffirm_purpose_grant_v1(uuid,uuid,uuid,jsonb,text,timestamptz,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.reaffirm_purpose_grant_v1(uuid,uuid,uuid,jsonb,text,timestamptz,boolean)
 to service_role;

notify pgrst, 'reload schema';
