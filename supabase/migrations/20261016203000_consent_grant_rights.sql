-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Path B is TEST-LOCAL only: the door below rechecks the
-- test-jurisdiction flag and refuses without it.
-- =====================================================================
--
-- api.consent-grant-rights (register; G2.1 "Build all 24"): a person who
-- confirmed a Path B request with no account turns on one individual purpose
-- for the person who added their file, through their adult-subject-control
-- rights session (directional-purpose-grant-v1, signer and data subject the
-- session principal, recipient the immutable current Path B uploader).
--
-- CLOSED TWICE OVER, on purpose:
--   * no issuer registers the adult-subject-control session purpose
--     (20261016202000 explains it), so no session of it can exist; and
--   * private.other_adult_mitigation_v1 still answers deny
--     (adult.non-account-holder-24mo) for the uploader of a no-account Path B
--     subject. That is checked at purpose-grant-create exactly as
--     grant_path_b_purpose_v1 checks it for the account branch, and it is
--     not changed here: opening uploader access is an owner decision.
-- Until both open, this door refuses every caller and writes nothing.
--
-- public.grant_purpose_rights_v1, in one transaction:
--   1. private.adult_subject_control_v1 (20261016202000) locks the session,
--      consumes its one-time operation nonce for grant-purpose, rechecks the
--      purpose matrix and locks the subject, the non-account principal at
--      the session's bound revision and the uploader principal;
--   2. the presentation the rights page minted must name exactly that
--      principal, uploader principal and account, subject binding revision,
--      the current uploader relationship and revision (or none yet) and the
--      one purpose; its own nonce is consumed too, so it grants at most once;
--   3. the purpose is one of the three Path B layers (copilot.local, which
--      the register lists, has no Path B scope and is refused);
--   4. the mitigation decision at purpose-grant-create must be allow;
--   5. consent.share-with-adult must still be the current artifact at the
--      presented version and body hash, the four statements exact, the typed
--      name present as ciphertext, and the person's own declared code well
--      formed. The register's jurisdictionAttestationVersion/Hash are not
--      taken: docs/route-divergence.json unhashableAttestationFields records
--      this route as serving jurisdictionCode instead (owner decisions
--      2026-09-13 and 2026-10-16, D-083);
--   6. the uploader relationship is reused or created, any older pair of
--      this one purpose to the uploader is superseded with no access gap, and
--      one signature, purpose_grants row and directional_grants row are
--      written with one identical grant revision, then audited.
--
-- No existing function, table, grant or constraint is changed.

do $predecessor$
begin
 if to_regprocedure('private.adult_subject_control_v1(text,text,text,text,boolean)') is null
  or to_regprocedure('private.other_adult_mitigation_v1(uuid,uuid,text)') is null
  or to_regprocedure('private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)') is null
  or to_regprocedure('private.append_legal_audit_event(text,uuid,text,text,jsonb)') is null
  or not exists(select 1 from private.rights_purpose_matrix where purpose='adult-subject-control'
   and action='grant-purpose' and route_id='api.consent-grant-rights') then
  raise exception using errcode='55000',message='consent grant rights prerequisite missing'; end if;
 if to_regprocedure('public.grant_purpose_rights_v1(text,text,jsonb,text[],bytea,text,boolean)') is not null then
  raise exception using errcode='55000',message='consent grant rights successor already exists'; end if;
end;
$predecessor$;

create function public.grant_purpose_rights_v1(p_session_hash text,p_nonce text,p_presentation jsonb,
 p_statement_keys text[],p_signing_name_ciphertext bytea,p_jurisdiction_code text,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare v_now timestamptz:=clock_timestamp(); c jsonb; m jsonb; a public.consent_artifacts%rowtype;
 v_purpose text; v_relationship uuid; v_relationship_revision bigint; v_signature uuid; v_grant uuid;
begin
 if p_presentation is null or jsonb_typeof(p_presentation) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p_presentation))<>10
  or not (p_presentation ?& array['principalId','uploaderPrincipalId','uploaderAccountId','subjectBindingRevision',
   'relationshipId','relationshipRevision','purpose','artifactVersion','artifactBodySha256','nonce']) then
  raise exception using errcode='42501',message='not_found'; end if;
 v_purpose:=p_presentation->>'purpose';
 if v_purpose is null or v_purpose not in ('reports.monogenic','reports.polygenic','ancestry') then
  raise exception using errcode='42501',message='not_found'; end if;
 c:=private.adult_subject_control_v1(p_session_hash,p_nonce,'grant-purpose','api.consent-grant-rights',
  p_test_jurisdiction);
 if c->>'uploaderPrincipalId' is null
  or (p_presentation->>'principalId',p_presentation->>'uploaderPrincipalId',p_presentation->>'uploaderAccountId',
      p_presentation->>'subjectBindingRevision')
   is distinct from (c->>'principalId',c->>'uploaderPrincipalId',c->>'uploaderAccountId',c->>'subjectBindingRevision') then
  raise exception using errcode='42501',message='not_found'; end if;
 select r.id,r.relationship_revision into v_relationship,v_relationship_revision from public.subject_relationships r
 where r.subject_id=(c->>'subjectId')::uuid and r.data_subject_principal_id=(c->>'principalId')::uuid
  and r.recipient_principal_id=(c->>'uploaderPrincipalId')::uuid and r.relationship_kind='uploader' and r.status='current'
 for update;
 if (v_relationship::text,v_relationship_revision::text)
  is distinct from (p_presentation->>'relationshipId',p_presentation->>'relationshipRevision') then
  raise exception using errcode='42501',message='not_found'; end if;
 perform private.consume_embryo_operation_nonce_v1(p_presentation->>'nonce',null,null,'grant_presentation',
  'rights_session',(c->>'sessionId')::uuid);

 -- other-adult-mitigation-state-v1 at purpose-grant-create, for the uploader.
 m:=private.other_adult_mitigation_v1((c->>'subjectId')::uuid,(c->>'uploaderAccountId')::uuid,'purpose-grant-create');
 if m->>'decision' is distinct from 'allow' then raise exception using errcode='42501',message='not_found'; end if;

 if p_statement_keys is distinct from array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time']
  or p_signing_name_ciphertext is null or octet_length(p_signing_name_ciphertext)<16
  or p_jurisdiction_code is null or p_jurisdiction_code!~'^[A-Z]{2}$' then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into a from public.consent_artifacts where artifact_key='consent.share-with-adult'
  and version=(p_presentation->>'artifactVersion')::integer and body_sha256=p_presentation->>'artifactBodySha256'
  and superseded_at is null and published_at<=v_now and effective_on<=timezone('UTC',v_now)::date
  and body_sha256=encode(extensions.digest(convert_to(body_markdown,'UTF8'),'sha256'),'hex') for share;
 if a.artifact_key is null then raise exception using errcode='42501',message='not_found'; end if;

 if v_relationship is null then
  insert into public.subject_relationships(subject_id,data_subject_principal_id,recipient_principal_id,
   recipient_account_id,relationship_kind,relationship_revision,status)
  values((c->>'subjectId')::uuid,(c->>'principalId')::uuid,(c->>'uploaderPrincipalId')::uuid,
   (c->>'uploaderAccountId')::uuid,'uploader',1,'current')
  returning id,relationship_revision into v_relationship,v_relationship_revision;
 end if;
 -- A current pair of this one purpose to the uploader is superseded in the
 -- same statement the new one is written in, so access never has a gap.
 with ended as (
  update public.purpose_grants pg set revoked_at=v_now,revocation_reason='superseded'
  from public.directional_grants dg where dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
   and pg.target_kind='subject' and pg.target_id=(c->>'subjectId')::uuid and pg.purpose=v_purpose
   and pg.signer_principal_id=(c->>'principalId')::uuid and pg.revoked_at is null and dg.status='current'
   and dg.direction='subject_to_recipient' and dg.recipient_account_id=(c->>'uploaderAccountId')::uuid
  returning pg.grant_id
 ) update public.directional_grants set status='superseded',ended_at=v_now where grant_id in(select grant_id from ended);
 insert into public.consent_signatures(artifact_key,artifact_version,artifact_body_sha256,signer_principal_id,
  signer_account_id,target_kind,target_id,purpose,statement_keys,signing_name_encrypted,jurisdiction_code,
  jurisdiction_revision,subject_binding_revision)
 values(a.artifact_key,a.version,a.body_sha256,(c->>'principalId')::uuid,null,'subject',(c->>'subjectId')::uuid,
  v_purpose,p_statement_keys,p_signing_name_ciphertext,p_jurisdiction_code,1,(c->>'subjectBindingRevision')::bigint)
 returning id into v_signature;
 insert into public.purpose_grants(grant_revision,target_kind,target_id,purpose,artifact_key,artifact_version,
  artifact_body_sha256,signature_id,signer_principal_id,data_subject_principal_id,subject_binding_revision,
  jurisdiction_code,jurisdiction_revision)
 values(1,'subject',(c->>'subjectId')::uuid,v_purpose,a.artifact_key,a.version,a.body_sha256,v_signature,
  (c->>'principalId')::uuid,(c->>'principalId')::uuid,(c->>'subjectBindingRevision')::bigint,p_jurisdiction_code,1)
 returning grant_id into v_grant;
 insert into public.directional_grants(grant_id,grant_revision,recipient_principal_id,recipient_account_id,
  relationship_id,relationship_or_pair_revision,direction)
 values(v_grant,1,(c->>'uploaderPrincipalId')::uuid,(c->>'uploaderAccountId')::uuid,v_relationship,
  v_relationship_revision,'subject_to_recipient');
 perform private.append_legal_audit_event('purpose.granted',null,'api.consent-grant-rights','accepted',
  jsonb_build_object('purpose',v_purpose,'target_kind','subject','direction','uploader'));
 return jsonb_build_object('recordKind','purpose_grant','recordId',v_grant,'artifactKey',a.artifact_key,
  'artifactVersion',a.version,'purposeKey',v_purpose,'signedAt',v_now);
end $$;
revoke all on function public.grant_purpose_rights_v1(text,text,jsonb,text[],bytea,text,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.grant_purpose_rights_v1(text,text,jsonb,text[],bytea,text,boolean)
 to service_role;

notify pgrst, 'reload schema';
