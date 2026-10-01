-- Path B's account branch (brief §5.2 Path B; G2.6 adult half; G5.3), under
-- TEST-LOCAL. The owner chose it as the next unit (docs/protocol/decisions.md,
-- 2026-09-28 evening): a person with an Inherit account confirms the request
-- there and sees the file there. The subject-level reading and purpose-grant
-- layer follows separately; nothing here reads, analyses or grants anything.
--
--   1. adult-subject-confirmation-v1, authenticatedTransaction, for
--      path-b-subject-esignature: the mailed request's rights session and a
--      signed-in account whose address is the invited one. The person signs
--      the same approved consent.subject-adult-esignature v1; their country is
--      the account's own current declaration, never a field of the request.
--      The subject stays owned by the uploader and is bound to the person's
--      account (subject_account_id); the one confirmation principal becomes
--      that account's. The no-account confirmation stays exactly as it was;
--      the two race under the same locks and exactly one commits.
--   2. The upload authority, the uploader's signing target and the person's
--      delete accept that principal, and a purged subject stops naming the
--      person's account.
--   3. adult-upload-revision-confirmation-v1 authorityCases.account-bound-subject:
--      no account session is needed to answer a file from its notice, but one
--      that is present must be the subject's own account, and a confirmation
--      rechecks that account's current jurisdiction.
--   4. The person's own account lists the files held for them: the name the
--      uploader typed, each file's kind, dates and state. Nothing else.
--   5. The retention sweep deletes a person's Path B subject when they ask to
--      delete their own account.
--
-- Contact digests go through the contact keyring exactly as the other account
-- matches do (20260928130100_invitation_keyring_quota_doors.sql): a keyed
-- definer resolves and declares the presented set and hands the body the
-- digest under the revision the invitation was written under.
--
-- Redefined functions keep their current bodies from
-- 20260928150000_other_adult_held_upload.sql; each change is marked
-- "20260930210000" beside it. No table is added.

-- 1. Whether an account may confirm or answer as the person ------------------
-- Live, not deleting, 18 or older if a date of birth is on file, and holding a
-- current own jurisdiction declaration: a country, the date it was declared,
-- and the current jurisdiction attestation it affirmed, by exact hash.
create function private.path_b_account_current_v1(p_account_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog
as $function$
 select exists(select 1 from public.profiles pr
  join public.consent_artifacts ja on ja.artifact_key='attestation.jurisdiction'
   and ja.version=pr.jurisdiction_attestation_version and ja.superseded_at is null
   and ja.body_sha256=pr.jurisdiction_attestation_sha256
  where pr.id=p_account_id and pr.deletion_requested_at is null
   and pr.jurisdiction_code is not null and pr.jurisdiction_declared_at is not null
   and (pr.date_of_birth is null
    or pr.date_of_birth<=(timezone('UTC',clock_timestamp())::date-interval '18 years')::date));
$function$;
revoke all on function private.path_b_account_current_v1(uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 2. Account confirmation of a Path B request --------------------------------
-- The body compares one account digest with the invitation's; the keyed
-- definer below chose it from the presented set.
create function private.confirm_path_b_subject_account_core_v1(p_session_hash text,p_nonce text,
 p_artifact_version integer,p_artifact_body_sha256 text,p_statement_keys text[],p_signing_name_ciphertext bytea,
 p_account_id uuid,p_auth_session_id uuid,p_account_email_hmac text,p_test_jurisdiction boolean)
returns text language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare v_now timestamptz; v_session public.rights_sessions%rowtype; v_token public.token_hashes%rowtype;
 v_candidate public.token_candidates%rowtype; v_invitation public.subject_invitations%rowtype;
 d public.adult_subject_drafts%rowtype; s public.subjects%rowtype; p public.subject_principals%rowtype;
 a public.consent_artifacts%rowtype; pr public.profiles%rowtype; v_dob date; v_revision bigint;
begin
 perform private.lock_invitation_transitions_v1();
 v_now:=clock_timestamp();
 if p_test_jurisdiction is distinct from true or p_session_hash is null or p_session_hash!~'^[0-9a-f]{64}$'
  or p_account_id is null or p_auth_session_id is null
  or p_account_email_hmac is null or p_account_email_hmac!~'^[0-9a-f]{64}$' then
  return 'unavailable'; end if;
 -- statement-keys:consent.subject-adult-esignature
 if p_statement_keys is distinct from array['knows-uploader-has-file','agrees-to-upload','shown-what-uploader-sees','may-withdraw-any-time']
  or p_signing_name_ciphertext is null or octet_length(p_signing_name_ciphertext)<16 or p_artifact_version is null then
  return 'unavailable'; end if;
 -- The account: its own live session, and a current own jurisdiction declaration.
 perform 1 from auth.sessions x where x.id=p_auth_session_id and x.user_id=p_account_id
  and (x.not_after is null or x.not_after>v_now);
 if not found or not private.path_b_account_current_v1(p_account_id) then return 'unavailable'; end if;
 select * into pr from public.profiles where id=p_account_id for update;
 select rs.* into v_session from public.rights_sessions rs where rs.session_hash=p_session_hash
  and rs.purpose='adult-subject-invitation' and rs.target_kind='subject' and rs.status='active' and rs.expires_at>v_now
 for update;
 if v_session.id is null then return 'unavailable'; end if;
 perform private.consume_embryo_operation_nonce_v1(p_nonce,null,null,'invitation_respond','rights_session',v_session.id);
 select th.* into v_token from public.token_hashes th where th.id=v_session.token_hash_id for update;
 v_invitation:=private.current_adult_subject_invitation_v1(v_session.token_hash_id,v_session.id);
 if v_token.id is null or v_invitation.id is null or private.invitation_contact_barred_v1(v_invitation.email_hmac)
  or p_account_email_hmac<>v_invitation.email_hmac then
  return 'unavailable'; end if;
 select * into d from public.adult_subject_drafts where subject_id=v_invitation.target_id and state='invited'
  and adult_flow='path-b-subject-esignature' and fixed_expires_at>v_now for update;
 select * into s from public.subjects where id=v_invitation.target_id for update;
 select * into p from public.subject_principals where id=v_invitation.invitee_principal_id and subject_id=s.id
  and status='pending' and principal_kind='non_account_subject' and account_id is null for update;
 select date_of_birth into v_dob from public.subject_demographics where subject_id=s.id;
 -- The uploader can never confirm for the person, in any account.
 if d.id is null or s.id is null or p.id is null or s.lifecycle<>'draft' or s.subject_account_id is not null
  or s.owner_account_id is distinct from d.owner_account_id or d.owner_account_id=p_account_id
  or v_session.principal_id<>p.id
  or v_dob is null or v_dob>(timezone('UTC',v_now)::date-interval '18 years')::date then
  return 'unavailable'; end if;
 select * into a from public.consent_artifacts where artifact_key='consent.subject-adult-esignature'
  and version=p_artifact_version and superseded_at is null and published_at<=v_now
  and effective_on<=timezone('UTC',v_now)::date for share;
 if a.artifact_key is null or a.body_sha256 is distinct from p_artifact_body_sha256
  or encode(extensions.digest(convert_to(a.body_markdown,'UTF8'),'sha256'),'hex') is distinct from p_artifact_body_sha256 then
  return 'unavailable'; end if;
 select tc.* into v_candidate from public.token_candidates tc where tc.id=v_token.candidate_id for update;

 -- The one confirmation principal becomes the person's account; its contact,
 -- where every later notice goes, follows the new principal revision.
 update public.subject_principals set account_id=p_account_id,principal_kind='account_subject',status='active',
  principal_revision=principal_revision+1 where id=p.id returning principal_revision into v_revision;
 update public.encrypted_contact_references set authority_revision=v_revision
  where principal_id=p.id and status='current';
 -- Owned by the uploader, bound to the person's account.
 update public.subjects set subject_account_id=p_account_id,lifecycle='active',
  subject_binding_revision=subject_binding_revision+1,lifecycle_revision=lifecycle_revision+1,updated_at=v_now
 where id=s.id returning * into s;
 insert into public.consent_signatures(artifact_key,artifact_version,artifact_body_sha256,signer_principal_id,
  signer_account_id,target_kind,target_id,purpose,statement_keys,signing_name_encrypted,jurisdiction_code,
  jurisdiction_revision,subject_binding_revision)
 values(a.artifact_key,a.version,a.body_sha256,p.id,p_account_id,'subject',s.id,'adult-subject-path-b-confirmation',
  p_statement_keys,p_signing_name_ciphertext,pr.jurisdiction_code,pr.jurisdiction_revision,s.subject_binding_revision);
 update public.subject_invitations set status='accepted',accepted_at=v_now,terminal_at=v_now,
  contact_purge_due_at=v_now+interval '30 days' where id=v_invitation.id;
 update public.token_hashes set status='consumed',ended_at=v_now where id=v_token.id and status='current';
 update public.token_candidates set state='invalidated' where id=v_candidate.id;
 update public.rights_sessions set status='consumed',ended_at=v_now where id=v_session.id;
 update public.draft_participant_slots set state='current',slot_revision=slot_revision+1
  where adult_draft_id=d.id and principal_id=p.id;
 update public.adult_subject_drafts set state='confirmed' where id=d.id;
 perform private.append_legal_audit_event('invitation.accepted',null,'api.withdraw','accepted',
  jsonb_build_object('invitation_kind','adult_subject','adult_flow','path-b-subject-esignature',
   'confirmation','account','revision',1));
 return 'accepted';
end;
$function$;
revoke all on function private.confirm_path_b_subject_account_core_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- The keyed definer: the transition lock, the presented account digest set
-- resolved against the keyring (a bare digest after a rotation or a set
-- missing a usable revision fails closed) and declared, and the body handed
-- the digest under the revision the invitation was written under.
create function private.confirm_path_b_subject_account_keyed_v1(p_session_hash text,p_nonce text,
 p_artifact_version integer,p_artifact_body_sha256 text,p_statement_keys text[],p_signing_name_ciphertext bytea,
 p_account_id uuid,p_auth_session_id uuid,p_account_email_hmac text,p_test_jurisdiction boolean,
 p_account_email_hmac_set jsonb)
returns text language plpgsql security definer set search_path=''
as $function$
declare v_set jsonb; v_contact text:=p_account_email_hmac; v_session public.rights_sessions%rowtype;
 v_invitation public.subject_invitations%rowtype; v_result text;
begin
 perform private.lock_invitation_transitions_v1();
 v_set:=private.resolve_hmac_set_v1('contact',p_account_email_hmac,p_account_email_hmac_set);
 if v_set is not null then
  perform private.declare_contact_alias_groups_v1(jsonb_build_array(v_set));
  select rs.* into v_session from public.rights_sessions rs where rs.session_hash=p_session_hash
   and rs.purpose='adult-subject-invitation' and rs.target_kind='subject' and rs.status='active'
   and rs.expires_at>clock_timestamp();
  if v_session.id is not null then
   v_invitation:=private.current_adult_subject_invitation_v1(v_session.token_hash_id,v_session.id);
  end if;
  v_contact:=private.presented_contact_digest_v1(v_set,v_invitation.email_hmac,v_invitation.email_hmac_key_revision);
 end if;
 v_result:=private.confirm_path_b_subject_account_core_v1(p_session_hash,p_nonce,p_artifact_version,
  p_artifact_body_sha256,p_statement_keys,p_signing_name_ciphertext,p_account_id,p_auth_session_id,v_contact,
  p_test_jurisdiction);
 perform private.declare_contact_alias_groups_v1('[]'::jsonb);
 return v_result;
end;
$function$;
revoke all on function private.confirm_path_b_subject_account_keyed_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean,jsonb)
 from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.confirm_path_b_subject_account_keyed_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean,jsonb)
 to service_role;
create function public.confirm_path_b_subject_account_v1(p_session_hash text,p_nonce text,
 p_artifact_version integer,p_artifact_body_sha256 text,p_statement_keys text[],p_signing_name_ciphertext bytea,
 p_account_id uuid,p_auth_session_id uuid,p_account_email_hmac text,p_test_jurisdiction boolean,
 p_account_email_hmac_set jsonb default null)
returns text language sql security invoker set search_path=''
as $function$ select private.confirm_path_b_subject_account_keyed_v1(p_session_hash,p_nonce,p_artifact_version,p_artifact_body_sha256,p_statement_keys,p_signing_name_ciphertext,p_account_id,p_auth_session_id,p_account_email_hmac,p_test_jurisdiction,p_account_email_hmac_set); $function$;
revoke all on function public.confirm_path_b_subject_account_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean,jsonb)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.confirm_path_b_subject_account_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean,jsonb)
 to service_role;

-- 3. The uploader, the upload authority and the person's delete ---------------
create or replace function private.path_b_signing_target_v1(p_account_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare s public.subjects%rowtype; d public.adult_subject_drafts%rowtype;
begin
 select * into s from public.subjects where id=p_subject_id for share;
 select * into d from public.adult_subject_drafts where subject_id=p_subject_id for share;
 if s.id is null or d.id is null or s.subject_class<>'other_adult' or s.upload_class is distinct from 'adult'
  or s.owner_account_id is distinct from p_account_id or d.owner_account_id is distinct from p_account_id
  -- 20260930210000: a confirmed subject may be bound to the person's own account,
  -- never to the uploader's.
  or (s.subject_account_id is not null and (d.state<>'confirmed' or s.subject_account_id=p_account_id))
  or d.adult_flow<>'path-b-subject-esignature'
  or not ((d.state in ('draft','invited') and s.lifecycle='draft' and d.fixed_expires_at>clock_timestamp())
   or (d.state='confirmed' and s.lifecycle='active')) then
  raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('subjectBindingRevision',s.subject_binding_revision,'draftState',d.state);
end;
$function$;

create or replace function private.path_b_subject_v1(p_account_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare s public.subjects%rowtype; d public.adult_subject_drafts%rowtype; p public.subject_principals%rowtype;
 e public.encrypted_contact_references%rowtype; v_signature uuid;
begin
 select * into s from public.subjects where id=p_subject_id for share;
 if s.id is null or s.subject_class<>'other_adult' or s.upload_class is distinct from 'adult'
  or s.lifecycle<>'active' or s.owner_account_id is distinct from p_account_id
  or s.subject_account_id is not distinct from p_account_id then
  raise exception using errcode='42501',message='not_found'; end if;
 -- path-b-only: a Path A subject never has a confirmed Path B draft.
 select * into d from public.adult_subject_drafts where subject_id=s.id and owner_account_id=p_account_id
  and adult_flow='path-b-subject-esignature' and evidence_kind='esignature' and state='confirmed' for share;
 if d.id is null then raise exception using errcode='42501',message='not_found'; end if;
 -- 20260930210000: the one confirmation principal is either the person with no
 -- account (subject_account_id null) or the person's own account.
 select * into p from public.subject_principals where subject_id=s.id and status='active'
  and ((principal_kind='non_account_subject' and account_id is null and s.subject_account_id is null)
   or (principal_kind='account_subject' and account_id=s.subject_account_id)) for share;
 if p.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select * into e from public.encrypted_contact_references where principal_id=p.id and status='current'
  and contact_ciphertext is not null and authority_revision=p.principal_revision for share;
 if e.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select cs.id into v_signature from public.consent_signatures cs
 join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
  and ca.body_sha256=cs.artifact_body_sha256
 where cs.target_kind='subject' and cs.target_id=s.id and cs.signer_principal_id=p.id and cs.signer_account_id is not distinct from p.account_id
  and cs.purpose='adult-subject-path-b-confirmation' and cs.subject_binding_revision=s.subject_binding_revision
  and ca.artifact_key='consent.subject-adult-esignature'
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 order by cs.signed_at desc limit 1;
 if v_signature is null then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('subjectBindingRevision',s.subject_binding_revision,
  'subjectLifecycleRevision',s.lifecycle_revision,'principalId',p.id,'principalRevision',p.principal_revision,
  'contactReferenceId',e.id,'confirmationSignatureId',v_signature);
end;
$function$;

create or replace function private.delete_path_b_subject_v1(p_subject_id uuid,p_state text)
returns integer language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare h record; n integer:=0; v_now timestamptz:=clock_timestamp();
begin
 for h in select id from public.other_adult_held_uploads where subject_id=p_subject_id
  and state in ('pending','confirmed') order by held_at,id loop
  if private.end_other_adult_held_upload_v1(h.id,p_state) then n:=n+1; end if;
 end loop;
 -- 20260930210000: the purged subject no longer names the person's account, so it
 -- never stands in the way of that account's own deletion.
 update public.subjects set lifecycle='purged',lifecycle_revision=lifecycle_revision+1,
  subject_binding_revision=subject_binding_revision+1,updated_at=v_now,subject_account_id=null
 where id=p_subject_id and lifecycle<>'purged';
 update public.encrypted_contact_references set contact_ciphertext=null,status='shredded',ended_at=v_now
  where principal_id in (select id from public.subject_principals where subject_id=p_subject_id) and status='current';
 update public.contact_hmac_indexes set status='revoked',expires_at=least(expires_at,v_now)
  where contact_reference_id in (select e.id from public.encrypted_contact_references e
   join public.subject_principals sp on sp.id=e.principal_id where sp.subject_id=p_subject_id) and status='current';
 update public.subject_principals set status='deleted',principal_revision=principal_revision+1
  where subject_id=p_subject_id and principal_kind in ('non_account_subject','account_subject')
   and status in ('active','pending');
 update public.subject_consents set revoked_at=v_now,revocation_reason='withdrawn'
  where subject_id=p_subject_id and consent_type='upload_class' and revoked_at is null;
 update public.rights_sessions set status='revoked',ended_at=v_now where status='active'
  and ((target_kind='subject' and target_id=p_subject_id)
   or (target_kind='adult_upload_revision' and target_id in (select id from public.other_adult_held_uploads where subject_id=p_subject_id)));
 perform private.append_legal_audit_event('subject.deleted',null,'api.withdraw',p_state,
  jsonb_build_object('upload_class','other_adult','revisions',n));
 return n;
end;
$function$;

-- 4. A file answer from an account-bound subject -----------------------------
drop function public.respond_adult_upload_revision_v1(text,text,text);
create function public.respond_adult_upload_revision_v1(p_session_hash text,p_nonce text,p_action text,
 p_account_id uuid default null)
returns text language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare r jsonb; v_now timestamptz; h public.other_adult_held_uploads%rowtype; v_subject_account uuid;
begin
 perform private.lock_invitation_transitions_v1();
 v_now:=clock_timestamp();
 if p_action is null or p_action not in ('confirm','refuse','delete') then return 'unavailable'; end if;
 r:=private.adult_upload_revision_session_v1(p_session_hash);
 if r is null then return 'unavailable'; end if;
 -- 20260930210000: adult-upload-revision-confirmation-v1 authorityCases.account-bound-subject.
 -- No account session is needed to use the delivered right, but one that is
 -- present must be the subject's own account, and a confirmation rechecks
 -- that account's current jurisdiction; the rights session never changes it.
 select s.subject_account_id into v_subject_account from public.subjects s where s.id=(r->>'subjectId')::uuid;
 if v_subject_account is not null and ((p_account_id is not null and p_account_id<>v_subject_account)
  or (p_action='confirm' and not private.path_b_account_current_v1(v_subject_account))) then
  return 'unavailable'; end if;
 perform private.consume_embryo_operation_nonce_v1(p_nonce,null,null,'adult_upload_respond','rights_session',
  (r->>'sessionId')::uuid);
 select * into h from public.other_adult_held_uploads where id=(r->>'revisionId')::uuid for update;
 if p_action='confirm' then
  if h.state<>'pending' or h.fixed_deadline<=v_now then return 'unavailable'; end if;
  -- adult-upload-revision-confirmation-v1: only this revision. The other_adult
  -- common gates are not built, so the outcome is confirmed_blocked_current_gate
  -- with zero job, and no purpose grant is created or revived.
  update public.other_adult_held_uploads set state='confirmed',confirmed_at=v_now,
   analysis_state='confirmed_blocked_current_gate' where id=h.id;
  update public.retention_due_phases set status='cancelled',claim_token_hash=null,claim_expires_at=null,
   completed_at=v_now,terminal_outcome_code='subject_confirmed'
  where retention_id='adult.unconfirmed-30d' and target_kind='upload_session' and target_id=h.upload_session_id
   and status in ('pending','retry');
  update public.retention_rows set state='cancelled',ended_at=v_now
  where retention_id='adult.unconfirmed-30d' and target_kind='upload_session' and target_id=h.upload_session_id
   and state in ('scheduled','active');
  perform private.append_legal_audit_event('upload.revision-confirmed',null,'api.withdraw','accepted',
   jsonb_build_object('upload_class','other_adult','revision',h.upload_revision,
    'outcome','confirmed_blocked_current_gate'));
  return 'confirmed';
 end if;
 update public.rights_sessions set status='consumed',ended_at=v_now where id=(r->>'sessionId')::uuid;
 if p_action='refuse' then
  -- adult-upload-revision-refusal-v1: only this revision and its source; the
  -- subject's confirmation, other files and the ended invitation stay as they are.
  perform private.end_other_adult_held_upload_v1(h.id,'refused');
  return 'refused';
 end if;
 perform private.delete_path_b_subject_v1(h.subject_id,'deleted');
 return 'deleted';
end;
$function$;
revoke all on function public.respond_adult_upload_revision_v1(text,text,text,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.respond_adult_upload_revision_v1(text,text,text,uuid) to service_role;

-- 5. What the person's own account shows ------------------------------------
-- The Path B people this account is bound to as the person: the name the
-- uploader typed, and each current file's kind, dates and state. No uploader,
-- address, file name, hash, object or identifier.
create function private.subject_held_files_v1(p_account_id uuid,p_session_id uuid,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare v_result jsonb;
begin
 if p_test_jurisdiction is distinct from true then return '[]'::jsonb; end if;
 perform 1 from auth.sessions x where x.id=p_session_id and x.user_id=p_account_id
  and (x.not_after is null or x.not_after>clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select coalesce(jsonb_agg(t.item order by t.created_at,t.id),'[]'::jsonb) into v_result from (
  select s.id,s.created_at,jsonb_build_object('label',s.display_label,
   'files',coalesce((select jsonb_agg(jsonb_build_object('state',h.state,
      'fileKind',case when h.file_type::text like 'array_%' then 'array' else 'vcf' end,
      'addedOn',h.held_at,'deleteBy',case when h.state='pending' then h.fixed_deadline end,
      'confirmedOn',h.confirmed_at) order by h.held_at,h.id)
     from public.other_adult_held_uploads h where h.subject_id=s.id and h.confirmation_principal_id=p.id
      and h.state in ('pending','confirmed')),'[]'::jsonb)) as item
  from public.subjects s
  join public.adult_subject_drafts d on d.subject_id=s.id and d.adult_flow='path-b-subject-esignature'
   and d.state='confirmed'
  join public.subject_principals p on p.subject_id=s.id and p.principal_kind='account_subject'
   and p.account_id=p_account_id and p.status='active'
  where s.subject_account_id=p_account_id and s.owner_account_id<>p_account_id
   and s.subject_class='other_adult' and s.lifecycle='active'
 ) t;
 return v_result;
end;
$function$;
revoke all on function private.subject_held_files_v1(uuid,uuid,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.subject_held_files_v1(uuid,uuid,boolean) to service_role;
create function public.subject_held_files_v1(p_account_id uuid,p_session_id uuid,p_test_jurisdiction boolean)
returns jsonb language sql security invoker set search_path=pg_catalog
as $function$ select private.subject_held_files_v1(p_account_id,p_session_id,p_test_jurisdiction); $function$;
revoke all on function public.subject_held_files_v1(uuid,uuid,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.subject_held_files_v1(uuid,uuid,boolean) to service_role;

-- 6. The retention sweep ------------------------------------------------------
create or replace function public.expire_due_other_adult_held_uploads_v1()
returns integer language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare v record; n integer:=0; v_now timestamptz;
begin
 perform private.lock_invitation_transitions_v1();
 v_now:=clock_timestamp();
 -- 20260930210000: a person who asked to delete their own account has every Path B
 -- subject bound to it deleted first, as their own delete would.
 for v in select s.id from public.subjects s
  join public.profiles pr on pr.id=s.subject_account_id
  join public.adult_subject_drafts d on d.subject_id=s.id
  where d.adult_flow='path-b-subject-esignature' and d.state='confirmed' and s.lifecycle='active'
   and s.subject_class='other_adult' and s.owner_account_id<>s.subject_account_id
   and pr.deletion_requested_at is not null
  order by s.id for update of s
 loop
  perform private.delete_path_b_subject_v1(v.id,'deleted');
  n:=n+1;
 end loop;
 for v in select h.id,
   case when p.id is null or p.deletion_requested_at is not null then 'withdrawn'
    when s.lifecycle<>'active' then 'deleted' else 'expired' end as reason
  from public.other_adult_held_uploads h
  join public.subjects s on s.id=h.subject_id
  left join public.profiles p on p.id=h.uploader_account_id
  where h.state in ('pending','confirmed') and ((h.state='pending' and h.fixed_deadline<=v_now)
   or p.id is null or p.deletion_requested_at is not null or s.lifecycle<>'active')
  order by h.fixed_deadline,h.id
 loop
  if private.end_other_adult_held_upload_v1(v.id,v.reason) then n:=n+1; end if;
 end loop;
 for v in select d.id,d.subject_id from public.adult_subject_drafts d
  where d.adult_flow='path-b-subject-esignature' and d.state='draft' and d.fixed_expires_at<=v_now
  order by d.fixed_expires_at,d.id for update of d
 loop
  update public.encrypted_contact_references set contact_ciphertext=null,status='shredded',ended_at=v_now
   where principal_id in (select id from public.subject_principals where subject_id=v.subject_id) and status='current';
  update public.subject_principals set status='deleted',principal_revision=principal_revision+1
   where subject_id=v.subject_id and status='pending';
  update public.subjects set lifecycle='purged',lifecycle_revision=lifecycle_revision+1,updated_at=v_now
   where id=v.subject_id and lifecycle='draft';
  update public.subject_consents set revoked_at=v_now,revocation_reason='retention_expired'
   where subject_id=v.subject_id and consent_type='upload_class' and revoked_at is null;
  update public.adult_subject_drafts set state='expired' where id=v.id;
  n:=n+1;
 end loop;
 return n;
end;
$function$;
