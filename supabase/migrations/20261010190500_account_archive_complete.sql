-- Complete account archive source/authority and owner-only TEST delivery.
-- Ordinary subject export and the old object-marker ACK remain separate.
-- This migration never enables the account R2 configuration.

-- A download is advanced by an exact browser receipt, not by a provider read.
-- State lives on the existing download row and follows its existing erasure.
alter table private.export_archive_downloads
 add column account_chunk_ordinal bigint,
 add column account_chunk_challenge_sha256 text,
 add column account_chunk_sha256 text,
 add column account_chunk_byte_count integer,
 add column account_chunk_issued_at timestamptz,
 add column account_chunk_acknowledged_at timestamptz,
 add constraint account_chunk_receipt_complete check ((
  (account_chunk_ordinal is null and account_chunk_challenge_sha256 is null and account_chunk_sha256 is null
   and account_chunk_byte_count is null and account_chunk_issued_at is null and account_chunk_acknowledged_at is null)
  or (account_chunk_ordinal>=0 and account_chunk_challenge_sha256~'^[a-f0-9]{64}$'
   and account_chunk_sha256~'^[a-f0-9]{64}$' and account_chunk_byte_count between 1 and 4000000
   and account_chunk_issued_at is not null
   and (account_chunk_acknowledged_at is null or account_chunk_acknowledged_at>=account_chunk_issued_at))) is true);

create function private.account_archive_test_configuration_v1() returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='250ms' as $$
declare c private.account_archive_r2_configuration;
begin
 if current_user<>'postgres' or session_user<>'postgres' then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 select * into c from private.account_archive_r2_configuration where singleton for share;
 if c.enabled is distinct from true or c.bucket is null or c.binding_sha256 is null then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 return jsonb_build_object('bucket',c.bucket,'bindingSha256',c.binding_sha256,
  'protocol','r2-current-object-qualified-all-writer-gateway-v1');
end $$;

-- No presentation nonce is minted or consumed by polling. The complete READY
-- result is selected from the original immutable completion, after currentness.
create function private.account_archive_test_ready_v1(p_origin jsonb,p_export_id uuid,p_export_cookie_hash text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='250ms' as $$
declare j private.export_archive_jobs;e public.generated_exports;a private.export_archive_attempts;p jsonb;value jsonb;
begin
 perform private.account_archive_test_configuration_v1();
 if private.account_archive_complete_enabled_v1(p_origin) is not true then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 if p_export_id is null or p_export_cookie_hash is null or p_export_cookie_hash!~'^[a-f0-9]{64}$' then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 select * into j from private.export_archive_jobs where export_id=p_export_id;
 if j.export_id is null or p_origin is distinct from j.origin or j.export_cookie_hash is distinct from p_export_cookie_hash then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 perform private.export_archive_current_v1(p_export_id,j.authority_receipt);
 select * into j from private.export_archive_jobs where export_id=p_export_id for update;
 select * into e from public.generated_exports where id=p_export_id for update;
 if e.status is distinct from 'ready' or j.origin is distinct from p_origin
  or j.export_cookie_hash is distinct from p_export_cookie_hash or j.active_attempt is null then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 a:=private.account_archive_r2_completed_context_v1(j.active_attempt,j.authority_receipt,true);
 p:=a.account_r2_completion->'producer';
 value:=jsonb_build_object('status','ready','exportId',e.id,'attemptId',a.id,'sizeBytes',a.byte_count,
  'sha256',a.archive_sha256,'manifestSha256',a.manifest_sha256,'expiresAt',e.expires_at,
  'authorityReceipt',j.authority_receipt,'principalHash',j.principal_hash,'segmentCount',a.segment_count,'pageCount',a.page_count,
  'memberCount',(p->>'memberCount')::bigint,'payloadBytes',(p->>'payloadBytes')::bigint,
  'memberSha256',p->>'memberSha256','manifestMemberSha256',p->>'manifestMemberSha256');
 perform private.export_archive_current_v1(p_export_id,j.authority_receipt);
 if private.account_archive_complete_enabled_v1(p_origin) is not true then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 return value;
end $$;

create function private.account_archive_test_delivery_context_v1(p_download_id uuid,p_download_hash text,p_origin jsonb)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='250ms' as $$
declare d private.export_archive_downloads;j private.export_archive_jobs;a private.export_archive_attempts;ready jsonb;
begin
 if current_user<>'postgres' or session_user<>'postgres' then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 select dr.* into d from private.export_archive_downloads dr
  join private.export_archive_jobs job on job.export_id=dr.export_id
  join public.generated_exports er on er.id=dr.export_id
  where dr.id=p_download_id and job.origin->>'kind'='account' and job.export_contract='account-export-v1'
   and er.target_kind='account' and er.origin_kind='account';
 -- Only a genuinely different download family can fall through the router.
 if d.id is null then return null;end if;
 perform private.account_archive_test_configuration_v1();
 if d.cookie_hash is distinct from p_download_hash then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 a:=private.account_archive_test_download_context_v1(d.attempt_id,d.authority_receipt,p_download_hash,p_origin);
 select * into d from private.export_archive_downloads where id=p_download_id and cookie_hash=p_download_hash for update;
 select * into j from private.export_archive_jobs where export_id=d.export_id;
 if d.id is null or d.attempt_id is distinct from a.id or d.authority_receipt is distinct from j.authority_receipt
  or p_origin is distinct from j.origin or d.next_sequence>a.segment_count then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 ready:=private.account_archive_test_ready_v1(p_origin,j.export_id,j.export_cookie_hash);
 return jsonb_build_object('sessionId',d.id,'nextSequence',d.next_sequence,'ready',ready);
end $$;

-- The trusted TEST producer calls this only after complete same-version
-- provider EOF and its original current-object check, while holding that lock.
-- It stores a digest of the browser receipt; no bearer is retained in SQL.
create function private.issue_account_archive_test_chunk_v1(p_download_id uuid,p_download_hash text,p_origin jsonb,
 p_ordinal bigint,p_challenge_hash text,p_sha256 text,p_byte_count bigint)
returns boolean language plpgsql security invoker set search_path='' set lock_timeout='250ms' as $$
declare context jsonb;d private.export_archive_downloads;s private.export_archive_segments;r jsonb;
begin
 context:=private.account_archive_test_delivery_context_v1(p_download_id,p_download_hash,p_origin);
 if context is null then raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 select * into d from private.export_archive_downloads where id=p_download_id for update;
 if p_ordinal is null or p_ordinal is distinct from d.next_sequence or p_challenge_hash is null
  or p_challenge_hash!~'^[a-f0-9]{64}$' or p_sha256 is null or p_sha256!~'^[a-f0-9]{64}$'
  or p_byte_count is null or p_byte_count not between 1 and 4000000
  or (d.account_chunk_ordinal is not null and d.account_chunk_acknowledged_at is null)
  or (d.account_chunk_ordinal is not null and d.account_chunk_ordinal>=p_ordinal) then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 r:=private.current_account_archive_test_object_v1(d.attempt_id,p_ordinal,d.authority_receipt,p_download_hash,p_origin);
 select * into s from private.export_archive_segments where attempt_id=d.attempt_id and ordinal=p_ordinal for share;
 if s.attempt_id is null or s.sha256 is distinct from p_sha256 or s.byte_count::bigint is distinct from p_byte_count
  or s.acknowledged_at is null or s.delete_acknowledged_at is not null then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 update private.export_archive_downloads set account_chunk_ordinal=p_ordinal,account_chunk_challenge_sha256=p_challenge_hash,
  account_chunk_sha256=p_sha256,account_chunk_byte_count=p_byte_count,account_chunk_issued_at=clock_timestamp(),
  account_chunk_acknowledged_at=null where id=d.id;
 if private.current_account_archive_test_object_v1(d.attempt_id,p_ordinal,d.authority_receipt,p_download_hash,p_origin) is distinct from r then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 return true;
end $$;

create function private.ack_account_archive_test_chunk_v1(p_download_id uuid,p_download_hash text,p_origin jsonb,
 p_ordinal bigint,p_challenge_hash text,p_sha256 text,p_byte_count bigint)
returns boolean language plpgsql security invoker set search_path='' set lock_timeout='250ms' as $$
declare context jsonb;d private.export_archive_downloads;s private.export_archive_segments;r jsonb;
begin
 context:=private.account_archive_test_delivery_context_v1(p_download_id,p_download_hash,p_origin);
 if context is null then raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 select * into d from private.export_archive_downloads where id=p_download_id for update;
 r:=private.current_account_archive_test_object_v1(d.attempt_id,p_ordinal,d.authority_receipt,p_download_hash,p_origin);
 select * into s from private.export_archive_segments where attempt_id=d.attempt_id and ordinal=p_ordinal for share;
 if d.next_sequence is distinct from p_ordinal or d.account_chunk_ordinal is distinct from p_ordinal
  or d.account_chunk_challenge_sha256 is distinct from p_challenge_hash or d.account_chunk_sha256 is distinct from p_sha256
  or d.account_chunk_byte_count::bigint is distinct from p_byte_count or d.account_chunk_issued_at is null
  or d.account_chunk_acknowledged_at is not null or s.attempt_id is null or s.sha256 is distinct from p_sha256
  or s.byte_count::bigint is distinct from p_byte_count or p_challenge_hash is null or p_sha256 is null or p_byte_count is null then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 if private.current_account_archive_test_object_v1(d.attempt_id,p_ordinal,d.authority_receipt,p_download_hash,p_origin) is distinct from r then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 update private.export_archive_downloads set next_sequence=next_sequence+1,account_chunk_acknowledged_at=clock_timestamp(),
  idle_expires_at=least(expires_at,clock_timestamp()+interval '5 minutes') where id=d.id and next_sequence=p_ordinal;
 if not found then raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 perform private.account_archive_test_delivery_context_v1(p_download_id,p_download_hash,p_origin);
 return true;
end $$;

revoke all on function private.account_archive_test_configuration_v1(),
 private.account_archive_test_ready_v1(jsonb,uuid,text),private.account_archive_test_delivery_context_v1(uuid,text,jsonb),
 private.issue_account_archive_test_chunk_v1(uuid,text,jsonb,bigint,text,text,bigint),
 private.ack_account_archive_test_chunk_v1(uuid,text,jsonb,bigint,text,text,bigint)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Independent raw-export authority for a named other adult. resource_authorized
-- has an owner shortcut and is deliberately not used by this capture.
-- The existing mitigation door governs Path B/uploader records only. Path A
-- deletes its draft on actual mailbox/session acceptance and binds the person
-- through adult_claim. A generic other_adult class is not itself this proof.
create function private.account_archive_other_adult_export_gate_v1(p_subject uuid,p_recipient uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare s public.subjects;b public.subject_account_bindings;p public.subject_principals;profile public.profiles;
 invitation jsonb;consents jsonb;mitigation jsonb;n bigint;
begin
 perform private.lock_invitation_transitions_v1();
 select * into s from public.subjects where id=p_subject for share;
 if s.id is null or s.subject_class is distinct from 'other_adult' or s.lifecycle is distinct from 'active'
  or private.public_appeal_target_held_v1('subject',s.id) then
  raise exception using errcode='42501',message='not_found';end if;
 perform 1 from public.adult_subject_drafts where subject_id=s.id order by id for share;
 if s.owner_account_id is not null or exists(select 1 from public.adult_subject_drafts
  where subject_id=s.id and adult_flow='path-b-subject-esignature') then
  mitigation:=private.other_adult_mitigation_v1(s.id,p_recipient,'export-create');
  if mitigation->>'decision' is distinct from 'allow' then
   raise exception using errcode='42501',message='not_found';end if;
  return jsonb_build_object('version','account-complete-other-adult-export-gate-v1','path','path-b',
   'mitigation',mitigation);
 end if;
 if s.subject_account_id is null or exists(select 1 from public.adult_subject_drafts where subject_id=s.id) then
  raise exception using errcode='42501',message='not_found';end if;
 select * into profile from public.profiles where id=s.subject_account_id for update;
 select * into b from public.subject_account_bindings where subject_id=s.id and account_id=s.subject_account_id
  and binding_kind='adult_claim' and status='current' and ended_at is null for share;
 select * into p from public.subject_principals where id=b.subject_principal_id and subject_id=s.id
  and account_id=s.subject_account_id and principal_kind='account_subject' and status='active' for share;
 if b.id is null or p.id is null or profile.id is null or profile.deletion_requested_at is not null
  or profile.jurisdiction_declared_at is null or profile.jurisdiction_code is null or profile.jurisdiction_code='XX' then
  raise exception using errcode='42501',message='not_found';end if;
 perform 1 from public.subject_invitations where target_kind='subject' and target_id=s.id order by id for share;
 select count(*),jsonb_agg(to_jsonb(i) order by i.id) into n,invitation from public.subject_invitations i
  where i.target_kind='subject' and i.target_id=s.id and i.invitation_kind='adult_subject'
   and i.invitee_principal_id=p.id and i.status='accepted' and i.accepted_at is not null
   and i.terminal_at=i.accepted_at and i.created_at<=i.accepted_at and i.accepted_at<=i.expires_at
   and i.accepted_at<=clock_timestamp();
 if n<>1 then raise exception using errcode='42501',message='not_found';end if;
 perform 1 from public.subject_consents where subject_id=s.id order by id for share;
 perform 1 from public.consent_signatures where target_kind='subject' and target_id=s.id order by id for share;
 perform 1 from public.consent_artifacts where artifact_key='consent.subject-adult' order by version for share;
 select coalesce(jsonb_agg(jsonb_build_object('consent',to_jsonb(c),'signature',to_jsonb(sig),
  'artifact',to_jsonb(a)) order by c.id),'[]') into consents from public.subject_consents c
  join public.consent_signatures sig on sig.id=c.signature_id
  join public.consent_artifacts a on a.artifact_key=sig.artifact_key and a.version=sig.artifact_version
  where c.subject_id=s.id and c.account_id=s.subject_account_id and c.consent_type='adult_source'
   and c.provider_key is null and c.revoked_at is null and(c.expires_at is null or c.expires_at>clock_timestamp())
   and 'variants'=any(c.scope) and sig.signer_principal_id=p.id and sig.signer_account_id=s.subject_account_id
   and sig.target_kind='subject' and sig.target_id=s.id and sig.purpose='adult-subject-account-acceptance'
   and sig.subject_binding_revision=s.subject_binding_revision and sig.jurisdiction_code=profile.jurisdiction_code
   and sig.jurisdiction_revision=profile.jurisdiction_revision
   and sig.statement_keys=array['age-18-plus','mailbox-control','no-inviter-access','identity-not-verified','revocable']
   and sig.signed_at>=(invitation->0->>'accepted_at')::timestamptz
   and sig.signed_at<=clock_timestamp() and a.artifact_key='consent.subject-adult' and a.version=1
   and sig.artifact_body_sha256=a.body_sha256 and a.superseded_at is null
   and a.published_at<=clock_timestamp() and a.effective_on<=timezone('UTC',clock_timestamp())::date
   and a.body_sha256=encode(extensions.digest(convert_to(a.body_markdown,'UTF8'),'sha256'),'hex');
 if jsonb_array_length(consents)=0 then raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('version','account-complete-other-adult-export-gate-v1','path','path-a',
  'invitation',invitation->0,'binding',to_jsonb(b),'principal',to_jsonb(p),'consents',consents);
end $$;
revoke all on function private.account_archive_other_adult_export_gate_v1(uuid,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- 'variants' is a signed scope, NOT a new purpose_grants purpose.
create function private.account_archive_raw_authority_v1(p_origin jsonb,p_subject uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare a uuid;sess uuid;s public.subjects;owner_profile public.profiles;recipient public.subject_principals;
 signer public.subject_principals;b public.subject_account_bindings;relationship public.subject_relationships;
 requested_purpose text;grants jsonb:='[]';value jsonb;consents jsonb;mitigation jsonb;session_receipt jsonb;n bigint;
begin
 if jsonb_typeof(p_origin) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_origin))<>3
  or not(p_origin ?& array['kind','accountId','sessionId']) or p_origin->>'kind' is distinct from 'account' then
  raise exception using errcode='42501',message='not_found';end if;
 a:=(p_origin->>'accountId')::uuid;sess:=(p_origin->>'sessionId')::uuid;
 perform 1 from auth.users where id in(a,(select subject_account_id from public.subjects where id=p_subject)) order by id for share;
 perform 1 from auth.sessions where id=sess and user_id=a for share;
 perform 1 from public.profiles where id in(a,(select subject_account_id from public.subjects where id=p_subject)) order by id for update;
 select * into s from public.subjects where id=p_subject for share;
 if s.id is null or s.subject_class not in('self','other_adult') or s.lifecycle is distinct from 'active'
  or s.subject_account_id is null or s.subject_account_id=a then
  raise exception using errcode='42501',message='not_found';end if;
 session_receipt:=private.family_report_session_v1(a,sess);
 select * into owner_profile from public.profiles where id=s.subject_account_id;
 perform 1 from auth.users where id=owner_profile.id and deleted_at is null
  and (banned_until is null or banned_until<=clock_timestamp());
 if not found or owner_profile.deletion_requested_at is not null or owner_profile.jurisdiction_declared_at is null
  or owner_profile.jurisdiction_code is null or owner_profile.jurisdiction_code='XX' then
  raise exception using errcode='42501',message='not_found';end if;
 perform 1 from public.subject_account_bindings where account_id in(a,s.subject_account_id) order by id for share;
 perform 1 from public.subject_principals where account_id in(a,s.subject_account_id) order by id for share;
 select sp.* into recipient from public.subject_account_bindings rb
  join public.subjects rs on rs.id=rb.subject_id join public.subject_principals sp on sp.id=rb.account_principal_id
  join public.subject_principals rp on rp.id=rb.subject_principal_id
  where rb.account_id=a and rb.status='current' and rb.ended_at is null and rs.subject_class='self'
   and rs.subject_account_id=a and rs.lifecycle in('active','restricted') and sp.status='active'
   and sp.account_id=a and sp.principal_kind='account_subject' and rp.status='active' and rp.account_id=a;
 select * into b from public.subject_account_bindings where subject_id=s.id and account_id=s.subject_account_id
  and status='current' and ended_at is null;
 select * into signer from public.subject_principals where id=b.subject_principal_id and subject_id=s.id
  and account_id=s.subject_account_id and status='active' and principal_kind='account_subject';
 if recipient.id is null or signer.id is null or b.id is null
  or private.family_sharing_paused_v1(s.subject_account_id,a) is distinct from false then
  raise exception using errcode='42501',message='not_found';end if;
 perform 1 from public.subject_relationships where subject_id=s.id order by id for share;
 select * into relationship from public.subject_relationships where subject_id=s.id
  and data_subject_principal_id=signer.id and recipient_principal_id=recipient.id and recipient_account_id=a
  and relationship_kind='family_member' and status='current';
 if relationship.id is null then raise exception using errcode='42501',message='not_found';end if;
 if s.subject_class='other_adult' then
  mitigation:=private.account_archive_other_adult_export_gate_v1(s.id,a);
 end if;
 perform 1 from public.purpose_grants where target_kind='subject' and target_id=s.id order by grant_id for share;
 perform 1 from public.directional_grants where recipient_account_id=a order by grant_id for share;
 perform 1 from public.consent_signatures where target_kind='subject' and target_id=s.id order by id for share;
 perform 1 from public.subject_consents where subject_id=s.id order by id for share;
 perform 1 from public.consent_artifacts where artifact_key in('consent.share-with-adult','consent.upload-self',
  'consent.subject-adult-esignature','consent.subject-adult','consent.raw-export') order by artifact_key,version for share;
 foreach requested_purpose in array array['export.share-link','raw.export'] loop
  select count(*),jsonb_agg(jsonb_build_object('grant',to_jsonb(g),'direction',to_jsonb(d),
   'signature',to_jsonb(cs),'artifact',to_jsonb(ca)) order by g.grant_id) into n,value
   from public.purpose_grants g join public.directional_grants d on d.grant_id=g.grant_id and d.grant_revision=g.grant_revision
   join public.consent_signatures cs on cs.id=g.signature_id
   join public.consent_artifacts ca on ca.artifact_key=g.artifact_key and ca.version=g.artifact_version
   where g.target_kind='subject' and g.target_id=s.id and g.purpose=requested_purpose
    and g.signer_principal_id=signer.id and g.data_subject_principal_id=signer.id
    and g.subject_binding_revision=s.subject_binding_revision and g.jurisdiction_code=owner_profile.jurisdiction_code
    and g.jurisdiction_revision=owner_profile.jurisdiction_revision and g.revoked_at is null
    and (g.expires_at is null or g.expires_at>clock_timestamp()) and d.status='current' and d.direction='subject_to_recipient'
    and d.recipient_principal_id=recipient.id and d.recipient_account_id=a and d.pair_id is null
    and d.relationship_id=relationship.id and d.relationship_or_pair_revision=relationship.relationship_revision
    and cs.signer_principal_id=signer.id and cs.signer_account_id=s.subject_account_id
    and cs.target_kind=g.target_kind and cs.target_id=g.target_id and cs.purpose=g.purpose
    and cs.subject_binding_revision=g.subject_binding_revision and cs.jurisdiction_code=g.jurisdiction_code
    and cs.jurisdiction_revision=g.jurisdiction_revision and cs.artifact_key=g.artifact_key
    and cs.artifact_version=g.artifact_version and cs.artifact_body_sha256=g.artifact_body_sha256
    and cs.statement_keys=array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time']
    and ca.artifact_key='consent.share-with-adult' and ca.body_sha256=g.artifact_body_sha256
    and ca.superseded_at is null and ca.published_at<=clock_timestamp()
    and ca.effective_on<=timezone('UTC',clock_timestamp())::date
    and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex');
  if n<>1 then raise exception using errcode='42501',message='not_found';end if;
  grants:=grants||value;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('consent',to_jsonb(c),'signature',to_jsonb(sig),
   'artifact',to_jsonb(artifact)) order by c.id),'[]') into consents from public.subject_consents c
  join public.consent_signatures sig on sig.id=c.signature_id
  join public.consent_artifacts artifact on artifact.artifact_key=sig.artifact_key and artifact.version=sig.artifact_version
  where c.subject_id=s.id and c.account_id=s.subject_account_id and c.consent_type in('self_source','adult_source','raw_export')
   and c.provider_key is null and c.revoked_at is null
   and (c.expires_at is null or c.expires_at>clock_timestamp()) and 'variants'=any(c.scope)
   and sig.signer_account_id=s.subject_account_id and sig.signer_principal_id=signer.id
   and sig.target_kind='subject' and sig.target_id=s.id and sig.subject_binding_revision=s.subject_binding_revision
   and sig.jurisdiction_revision=owner_profile.jurisdiction_revision and sig.jurisdiction_code=owner_profile.jurisdiction_code
   and sig.artifact_body_sha256=artifact.body_sha256 and artifact.superseded_at is null
   and artifact.published_at<=clock_timestamp() and artifact.effective_on<=timezone('UTC',clock_timestamp())::date
   and artifact.body_sha256=encode(extensions.digest(convert_to(artifact.body_markdown,'UTF8'),'sha256'),'hex');
 if jsonb_array_length(consents)=0 then raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('version','account-complete-raw-authority-v1','origin',p_origin,'session',session_receipt,
  'subject',to_jsonb(s),'subjectBinding',to_jsonb(b),'signer',to_jsonb(signer),'recipient',to_jsonb(recipient),
  'relationship',to_jsonb(relationship),'grants',grants,'scopeConsents',consents,'mitigation',mitigation);
end $$;

-- Source metadata is not a read entitlement. Its physical owner argument is
-- the real stored file owner; the independently signed raw tuple above names
-- the actual reader. No owner session or own-reader identity is fabricated.
create function private.account_archive_raw_source_v1(p_origin jsonb,p_file uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare f public.genome_files;authority jsonb;metadata jsonb;m private.own_prepared_manifests;
 item record;members bigint:=0;prepared jsonb;frame jsonb;
begin
 select * into f from public.genome_files where id=p_file;
 if f.id is null then raise exception using errcode='42501',message='not_found';end if;
 authority:=private.account_archive_raw_authority_v1(p_origin,f.subject_id);
 select * into f from public.genome_files where id=p_file for share;
 if f.tier is distinct from 1 or f.status not in('stored','annotated') or f.is_cohort_file or f.cohort_id is not null
  or f.single_logical_sample_verified_at is null or f.structural_validator_version is distinct from 'single-logical-sample-v1'
  or f.normalization_completed_at is null or f.normalization_source_revision is distinct from f.upload_revision
  or f.source_sha256 is null or f.user_id is null then raise exception using errcode='42501',message='not_found';end if;
 metadata:=private.own_report_source_metadata_v1(f.user_id,f.id,true);
 if metadata ? 'preparedSource' then
  select * into m from private.own_prepared_manifests where file_id=f.id for share;
  for item in select a.id from private.own_prepared_manifest_members mm join private.own_preparation_artifacts a on a.id=mm.artifact_id
   where mm.manifest_id=m.id order by a.id for share of mm,a loop
   perform private.own_preparation_artifact_current_v1(item.id,true);members:=members+1;
  end loop;
  if members is distinct from m.member_count::bigint or private.own_prepared_membership_v1(m.id) is distinct from m.membership_sha256 then
   raise exception using errcode='42501',message='not_found';end if;
  prepared:=private.own_prepared_manifest_receipt_v1(m);
 end if;
 frame:=private.export_account_original_frame_v1(f.id,metadata ? 'preparedSource');
 if private.account_archive_raw_authority_v1(p_origin,f.subject_id) is distinct from authority
  or private.own_report_source_metadata_v1(f.user_id,f.id,true) is distinct from metadata then
  raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('version','account-complete-raw-source-v1','file',to_jsonb(f),'rawAuthority',authority,
  'metadata',metadata,'originalFrame',frame,'preparedManifest',prepared);
end $$;

revoke all on function private.account_archive_raw_authority_v1(jsonb,uuid),private.account_archive_raw_source_v1(jsonb,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Discovery grants neither a claim nor a disposal transition. The original
-- cleanup workflow must already have stopped the exact attempt; a download
-- ACK or poll cannot shorten either its lease fence or its allocation deadline.
-- A missing provider completion does not hide a possibly written reservation.
create function private.account_archive_test_disposal_due_v1() returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='250ms' as $$
declare value jsonb;
begin
 if current_user<>'postgres' or session_user<>'postgres' then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 select coalesce(jsonb_agg(jsonb_build_object('attemptId',x.attempt_id,'ordinal',x.ordinal)
   order by x.attempt_id,x.ordinal),'[]'::jsonb) into value from(
  select allocation.attempt_id,allocation.ordinal from private.account_archive_r2_allocations allocation
   join private.export_archive_attempts attempt on attempt.id=allocation.attempt_id
   join private.export_archive_jobs job on job.export_id=attempt.export_id
   join public.generated_exports export on export.id=job.export_id
  where job.origin->>'kind'='account' and export.origin_kind='account'
   and export.target_kind='account' and export.account_id=export.target_id
   and job.origin->>'accountId'=export.account_id::text
   and job.route_id='api.export' and job.export_contract='account-export-v1'
   and attempt.state='cleanup_pending' and attempt.stopped_at is not null
   and attempt.cleanup_not_before<=clock_timestamp()
   and allocation.original_deadline+interval '30 seconds'<=clock_timestamp()
   and allocation.disposed_at is null
   and (allocation.disposal_claim_expires_at is null or allocation.disposal_claim_expires_at<=clock_timestamp())
  order by allocation.attempt_id,allocation.ordinal limit 128
 )x;
 return value;
end $$;

-- This is intentionally distinct from the old permanent-empty-marker ACK.
-- Only the trusted owner, while holding the original exact reservation locks,
-- can acknowledge actual absence under a retained terminal all-writer fence.
create function private.ack_account_archive_r2_object_absence_v1(p_attempt uuid,p_ordinal bigint,p_claim text,
 p_reservation jsonb,p_evidence jsonb) returns boolean
language plpgsql security invoker set search_path='' set lock_timeout='250ms' as $$
declare value jsonb;
begin
 if current_user<>'postgres' or session_user<>'postgres' then
  raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 value:=private.check_account_archive_r2_disposal_v1(p_attempt,p_ordinal,p_claim,p_reservation);
 if jsonb_typeof(p_evidence) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p_evidence))<>7
  or not(p_evidence ?& array['version','reservationSha256','allocationSha256','disposition','historyScope','terminal','absent'])
  or p_evidence->>'version' is distinct from 'account-archive-r2-object-absent-v1'
  or p_evidence->>'reservationSha256' is distinct from value->>'reservationSha256'
  or p_evidence->>'allocationSha256' is distinct from value->>'allocationSha256'
  or p_evidence->>'disposition' is distinct from 'current-object-absent'
  or p_evidence->>'historyScope' is distinct from 'current-object-only'
  or p_evidence->'terminal' is distinct from 'true'::jsonb
  or p_evidence->'absent' is distinct from 'true'::jsonb then
  raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 update private.account_archive_r2_allocations set disposed_at=clock_timestamp(),disposal_evidence=p_evidence
  where attempt_id=p_attempt and ordinal=p_ordinal and disposed_at is null;
 if not found then raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 update private.export_archive_segments set delete_acknowledged_at=clock_timestamp()
  where attempt_id=p_attempt and ordinal=p_ordinal;
 return true;
end $$;
revoke all on function private.account_archive_test_disposal_due_v1(),
 private.ack_account_archive_r2_object_absence_v1(uuid,bigint,text,jsonb,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Complete-account compatibility helpers preserve the exact existing own and
-- claimed-bound source checks. Their named legacy subset omits only sources
-- whose full census and permission live in the distinct complete routed frame.
-- The original subject helpers and public subject ABI remain unchanged.
create function private.account_archive_bound_snapshot_v1(p_origin jsonb,p_subject uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor jsonb; b private.future_person_account_bindings; s public.subjects; x private.embryo_canonical_sources;
 source_frame jsonb; expires timestamptz; ledger jsonb;
 custody private.future_person_custody_slices; f public.genome_files; item record;
 state_hash bytea; count_variants bigint:=0; count_scores bigint:=0; count_figures bigint:=0;
 count_reports bigint:=0; count_qc bigint:=0; parts uuid[]; origin_hash text; receipt text; agreements jsonb;
begin
 if jsonb_typeof(p_origin) is distinct from 'object' or p_origin->>'kind' is distinct from 'account'
  or (select count(*) from jsonb_object_keys(p_origin))<>3 or not(p_origin ?& array['kind','accountId','sessionId']) then
  raise exception using errcode='42501',message='not_found';end if;
 actor:=private.future_person_archive_account_actor_v1((p_origin->>'accountId')::uuid,(p_origin->>'sessionId')::uuid);
 source_frame:=private.future_person_bound_source_for_actor_v1(p_subject,clock_timestamp()+interval '30 seconds',actor);
 if source_frame is null then raise exception using errcode='42501',message='not_found';end if;
 select least(ss.created_at+interval '15 minutes',ss.not_after) into expires from auth.sessions ss
  where ss.id=(actor->>'sessionId')::uuid and ss.user_id=(actor->>'accountId')::uuid;
 if expires is null or expires<=clock_timestamp() then raise exception using errcode='42501',message='not_found';end if;
 select * into b from private.future_person_account_bindings where subject_id=p_subject and account_id=(actor->>'accountId')::uuid;
 select * into s from public.subjects where id=p_subject;
 select * into custody from private.future_person_custody_slices where subject_id=s.id;
 select * into x from private.embryo_canonical_sources where file_id=custody.source_file_id and subject_id=s.id;
 select * into f from public.genome_files where id=x.file_id;
 select array_agg(m.part_id order by m.sequence) into parts from private.embryo_canonical_source_parts m where m.file_id=x.file_id;
 if x.call_immutability_proof is distinct from 'exact-staged-calls-v1' then
  raise exception using errcode='55000',message='export_source_immutability_unproven';end if;
 if x.file_id is null or f.id is null or f.user_id is distinct from (actor->>'accountId')::uuid or f.subject_id<>s.id
  or f.cohort_id is not null or f.is_cohort_file or f.status<>'stored' or f.source_publication_state<>'published' or f.source_publication_revision<>x.publication_revision or f.source_sha256<>x.source_sha256
  or (select count(*) from public.genome_files where subject_id=s.id)<>1
  or cardinality(parts) is distinct from x.part_count
  or private.embryo_canonical_source_sha256_v1(x.file_id) is distinct from x.source_sha256
  or private.embryo_canonical_membership_sha256_v1(parts) is distinct from x.membership_sha256
  or exists(select 1 from private.embryo_canonical_parts p where p.id=any(parts)
    and (p.state<>'landed' or p.provider_version is null or p.provider_etag is null or p.observed_sha256<>p.sha256)) then
   raise exception using errcode='42501',message='not_found'; end if;
 agreements:=custody.agreement_slice;
 -- Old abbreviated custody snapshots are not silently relabeled complete.
 -- The original signed body must hash to the recorded signed body, and a
 -- genuine signing-name ciphertext plus individually affirmed statements
 -- must exist. Original identity-document bytes are never a fallback.
 if jsonb_array_length(agreements)=0 or exists(select 1 from jsonb_array_elements(agreements) a where
   a->>'version' is distinct from 'future-person-agreement-v2'
   or a->>'bodySha256' is distinct from a->>'recomputedBodySha256'
   or encode(extensions.digest(convert_to(a->>'bodyMarkdown','UTF8'),'sha256'),'hex') is distinct from a->>'bodySha256'
   or a->>'signingNameCiphertext' is null or length(a->>'signingNameCiphertext')<58
   or (a->>'signingNameCiphertext')!~'^[0-9a-f]+$' or length(a->>'signingNameCiphertext')%2<>0
   or jsonb_typeof(a->'statementKeys') is distinct from 'array' or jsonb_array_length(a->'statementKeys')=0
   or a->>'recordedRole' is null or a->>'signaturePurpose' is null
   or not(case a->>'artifactKey' when 'consent.upload-embryo' then a->>'signaturePurpose' in ('embryo-upload-parent-class','embryo-upload-uploader-class')
     when 'attestation.embryo-parentage' then a->>'signaturePurpose'='embryo-parentage-attestation'
     when 'attestation.embryo-disposition-rights' then a->>'signaturePurpose'='embryo-disposition-rights-attestation'
     when 'attestation.embryo-single-parent-basis' then a->>'signaturePurpose'='embryo-single-parent-basis-attestation'
     when 'charter.future-person' then a->>'signaturePurpose'='future-person-charter-acknowledgement'
     when 'disclosure.insurance-and-discrimination' then a->>'signaturePurpose'='disclosure-acknowledgement' else false end)
   or jsonb_typeof(a->'attestations') is distinct from 'array'
   or ((a->>'artifactKey' like 'attestation.%' or a->>'artifactKey'='charter.future-person') and jsonb_array_length(a->'attestations')=0)
   or exists(select 1 from jsonb_array_elements(a->'attestations') t where t->>'affirmed' is distinct from 'true'
      or jsonb_typeof(t->'statementKeys') is distinct from 'array' or jsonb_array_length(t->'statementKeys')=0)) then
  raise exception using errcode='55000',message='export_historical_agreement_unavailable'; end if;
 origin_hash:=encode(extensions.digest(jsonb_build_object('version','bound-own-export-origin-v1',
   'actor',actor,'binding',to_jsonb(b),'source',private.future_person_bound_archive_frame_v1(source_frame))::text,'sha256'),'hex');
 state_hash:=extensions.digest(jsonb_build_object('origin',origin_hash,'custody',to_jsonb(custody),
   'source',to_jsonb(x),'file',to_jsonb(f))::text,'sha256');
 -- Canonical publication inserted every exact staged call under the immutable
 -- copy guard, and the approval transaction checked complete cardinality.
 -- Claimed rows cannot be inserted, updated or partially deleted thereafter.
 -- This permits constant source checking without rescanning ten million calls
 -- for each bounded page. Canonical parts/source remain independently frozen.
 count_variants:=x.variant_count;
 state_hash:=extensions.digest(state_hash||convert_to('immutable-canonical-calls-v1:'||x.source_sha256||':'||count_variants,'UTF8'),'sha256');
 -- Related portrait source state is captured, never silently exported by this
 -- legacy claimed-bound subframe. The complete routed disposition decides it.
 state_hash:=extensions.digest(state_hash||convert_to(coalesce((select jsonb_agg(to_jsonb(r) order by r.id)
  from public.portrait_results r where r.parent_a_subject_id=s.id or r.parent_b_subject_id=s.id),'[]')::text,'UTF8'),'sha256');
 for item in select * from public.embryo_qc where embryo_id=x.embryo_id order by embryo_id loop
  state_hash:=extensions.digest(state_hash||convert_to('qc:'||to_jsonb(item)::text,'UTF8'),'sha256'); count_qc:=count_qc+1;
 end loop;
 for item in select * from public.embryo_scores where embryo_id=x.embryo_id order by id loop
  if item.source_binding_fingerprint<>x.source_sha256 then raise exception using errcode='55000',message='export_source_unavailable'; end if;
  state_hash:=extensions.digest(state_hash||convert_to('scores:'||to_jsonb(item)::text,'UTF8'),'sha256'); count_scores:=count_scores+1;
 end loop;
 for item in select fig.* from public.embryo_figures fig join public.embryo_scores score on score.id=fig.finding_id
   where score.embryo_id=x.embryo_id order by fig.id loop
  state_hash:=extensions.digest(state_hash||convert_to('figures:'||to_jsonb(item)::text,'UTF8'),'sha256'); count_figures:=count_figures+1;
 end loop;
 for item in select * from public.report_artifacts where subject_id=s.id order by id loop
  if item.source_binding_fingerprint<>x.source_sha256 then raise exception using errcode='55000',message='export_source_unavailable'; end if;
  state_hash:=extensions.digest(state_hash||convert_to('reports:'||to_jsonb(item)::text,'UTF8'),'sha256'); count_reports:=count_reports+1;
 end loop;
 ledger:=private.future_person_bound_export_audit_v1(p_subject);
 state_hash:=extensions.digest(state_hash||convert_to(ledger::text,'UTF8'),'sha256');
 receipt:=encode(state_hash,'hex');
 return jsonb_build_object('authority',jsonb_build_object('principalId',b.claimant_principal_id,'subjectId',s.id,
   'originBinding',origin_hash,'authorityReceipt',receipt,'lifecycleRevision',s.lifecycle_revision,
   'bindingRevision',s.subject_binding_revision,'credentialRevision',b.release_revision,'expiresAt',expires),
  'source',jsonb_build_object('fileId',x.file_id,'subjectId',s.id,'referenceBuild',x.reference_build,
    'sourceSha256',x.source_sha256,'membershipSha256',x.membership_sha256,'publicationRevision',x.publication_revision,
    'variantCount',count_variants,'publishedAt',x.published_at),
  'membership',jsonb_build_object('variants',count_variants,'qualityReports',count_qc,'scores',count_scores,
    'figures',count_figures,'reports',count_reports,'agreements',jsonb_array_length(agreements),'legalAuditEvents',ledger->'count'),
  'legalAudit',ledger->'metadata');
end $$;
create function private.account_archive_legacy_graph_v1(p_account uuid,p_capture jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare subjects uuid[];anchor uuid;kind text;item record;identity text;digest bytea;n bigint;inventory jsonb:='[]';
begin
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(p_capture#>'{authority,subjectPartitions}')x;
 select s.id into anchor from public.subjects s where s.id=any(subjects) and s.subject_class='self'
  and s.subject_account_id=p_account and s.lifecycle in('active','restricted') for share nowait;
 if anchor is null then raise exception using errcode='42501',message='not_found';end if;
 -- Whole complete capture separately binds every parent science source and
 -- its scoped disposition. This helper returns only the original minimized
 -- seven metadata classes; it never authorizes their scientific counterparts.
 foreach kind in array array['embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
  'embryo_disposition_proposals','embryo_disposition_confirmations','family_pairs'] loop
  digest:=extensions.digest(convert_to('account-graph-routed-v2|'||kind,'UTF8'),'sha256');n:=0;
  for item in select * from private.export_account_graph_projection_v1(p_account,subjects,kind)
   order by (projected_key->>0) collate "C",coalesce(projected_key->>1,'') collate "C",
    coalesce(projected_key->>2,'') collate "C",coalesce((projected_key->>3)::bigint,0) loop
   identity:=private.export_account_graph_cursor_v1(kind,item.projected_key);
   if octet_length(item.projected_row::text)>8192 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
   n:=n+1;if n>9007199254740991 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
   digest:=extensions.digest(digest||convert_to(identity||':'||anchor::text||':requester-account-history:'||item.projected_row::text||E'\n','UTF8'),'sha256');
  end loop;
  inventory:=inventory||jsonb_build_array(jsonb_build_object('kind',kind,'rows',n,'membershipSha256',encode(digest,'hex'),
   'partitions',case when n=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('subjectId',anchor,'rows',n)) end));
 end loop;
 return jsonb_build_object('anchorSubjectId',anchor,'inventory',inventory,
  'pairSourceFrame',(select coalesce(jsonb_agg(to_jsonb(fp) order by fp.id),'[]') from public.family_pairs fp
   where fp.subject_a_id=any(subjects) or fp.subject_b_id=any(subjects)));
end $$;
create function private.account_archive_legacy_classes_v1(p_account uuid,p_capture jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare subjects uuid[];cohorts uuid[];kind text;handling text;item record;n bigint;digest bytea;counts jsonb;out jsonb:='[]';
 scientific_frame jsonb;ordinary uuid[];requester_frame jsonb;
begin
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(p_capture#>'{authority,subjectPartitions}')x;
 select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into ordinary from jsonb_array_elements(p_capture->'partitions')x
  where x->>'class'='ordinary';
 select array_agg(id order by id) into cohorts from(select c.id from public.embryo_cohorts c where c.owner_account_id=p_account
  union select s.cohort_id from public.embryo_participant_sets s join public.subject_principals p on p.id=s.principal_id where p.account_id=p_account)x;
 scientific_frame:=(select coalesce(jsonb_agg(x->'capture' order by x->>'subjectId'),'[]') from jsonb_array_elements(p_capture->'partitions')x
  where x->>'class'='claimed-bound');
 foreach kind in array array['ancestry_regions','appeal_intakes','attestation_contradictions','correction_requests','directional_grants',
  'embryo_basis_bindings','embryo_cohorts','embryo_disposition_confirmations','embryo_disposition_proposals','embryo_donor_attributions',
  'embryo_figures','embryo_participant_sets','embryo_qc','embryo_scores','embryo_variants','embryos','family_pairs','family_sharing_pauses',
  'family_sharing_stops','future_person_claim_objections','future_person_claimant_principals','future_person_claims','portrait_results',
  'report_artifacts','subject_control_refusal_authorities','subject_relationships','suppressions','other_adult_held_uploads','path_b_report_bindings'] loop
  n:=0;counts:='[]';digest:=extensions.digest(convert_to('account-class-members-v1|'||kind,'UTF8'),'sha256');
  if kind in('attestation_contradictions','directional_grants','family_sharing_pauses','family_sharing_stops','future_person_claim_objections',
   'future_person_claimant_principals','future_person_claims','subject_control_refusal_authorities','subject_relationships','suppressions') then
   handling:='metadata';
   for item in select * from private.export_account_class_projection_v1(p_account,subjects,kind) loop
    if octet_length(item.projected_row::text)>8192 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
    n:=n+1;digest:=extensions.digest(digest||convert_to(item.projected_id::text||':'||coalesce(item.projected_subject::text,'')||':'||item.projected_row::text||E'\n','UTF8'),'sha256');
   end loop;
   select coalesce(jsonb_agg(jsonb_build_object('subjectId',x.subject,'rows',x.n) order by x.subject),'[]') into counts from(
    select projected_subject subject,count(*) n from private.export_account_class_projection_v1(p_account,subjects,kind)
    where projected_subject is not null group by projected_subject)x;
  elsif kind in('embryo_figures','embryo_qc','embryo_scores','embryo_variants','embryos','report_artifacts') then
   handling:='claimed-bound';
   -- Original bound capture already independently validates full source,
   -- immutable calls and exact complete QC/finding/figure/report membership.
   -- Parent-cohort files and ordinary arbitrary artifact payloads are refused.
   -- Ordinary and parent-cohort artifact sources belong only to the complete
   -- routed census. This legacy scientific receipt covers claimed-bound rows.
   for item in select x->>'subjectId' subject,x->'capture' snapshot from jsonb_array_elements(p_capture->'partitions')x where x->>'class'='claimed-bound' loop
    n:=case kind when 'embryos' then 1 when 'embryo_qc' then (item.snapshot#>>'{membership,qualityReports}')::bigint
     when 'embryo_scores' then (item.snapshot#>>'{membership,scores}')::bigint when 'embryo_figures' then (item.snapshot#>>'{membership,figures}')::bigint
     when 'embryo_variants' then (item.snapshot#>>'{membership,variants}')::bigint when 'report_artifacts' then (item.snapshot#>>'{membership,reports}')::bigint end;
    if n>0 then counts:=counts||jsonb_build_array(jsonb_build_object('subjectId',item.subject,'rows',n));end if;
   end loop;
   select coalesce(sum((x->>'rows')::bigint),0) into n from jsonb_array_elements(counts)x;
   digest:=extensions.digest(convert_to('account-class-members-v1|'||kind||'|'||scientific_frame::text,'UTF8'),'sha256');
  elsif kind in('embryo_basis_bindings','embryo_cohorts','embryo_disposition_confirmations','embryo_disposition_proposals',
   'embryo_donor_attributions','embryo_participant_sets','family_pairs') then
   handling:='graph';
   select (x->>'rows')::bigint,decode(x->>'membershipSha256','hex'),x->'partitions' into n,digest,counts
    from jsonb_array_elements(p_capture#>'{readableGraph,inventory}')x where x->>'kind'=kind;
   if n is null or digest is null or counts is null then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  elsif kind='path_b_report_bindings' then
   handling:='path-b-results';
   for item in select x->>'id' id,x->>'subjectId' subject,x->>'rowText' row_text
    from jsonb_array_elements(p_capture->'pathBResults')s cross join lateral jsonb_array_elements(s->'records')x
    order by (x->>'id') collate "C" loop
    n:=n+1;digest:=extensions.digest(digest||convert_to(item.id||':'||item.subject||':'||item.row_text||E'\n','UTF8'),'sha256');
   end loop;
   select coalesce(jsonb_agg(jsonb_build_object('subjectId',x->'subjectId','rows',x->'rows') order by x->>'subjectId'),'[]') into counts
    from jsonb_array_elements(p_capture->'pathBResults')x where (x->>'rows')::bigint>0;
   -- Exact recipient-scoped internal bindings have a registered result-only
   -- subject projection. Other recipients' grants/results are not borrowed.
   if n<>(select count(*) from private.path_b_report_bindings b where b.recipient_account_id=p_account) then
    raise exception using errcode='0A000',message='export_result_projection_unavailable';end if;
  elsif kind='other_adult_held_uploads' then
   handling:='excluded';
   select count(*) into n from public.other_adult_held_uploads h where h.uploader_account_id=p_account or h.subject_id=any(subjects);
   if n<>coalesce((select sum((x->>'excludedHeldUploads')::bigint) from jsonb_array_elements(p_capture->'pathBResults')x),0) then
    raise exception using errcode='0A000',message='export_result_projection_unavailable';end if;
   digest:=extensions.digest(convert_to('account-excluded-held-objects-v1|'||coalesce((select jsonb_agg(to_jsonb(h) order by h.id)
    from public.other_adult_held_uploads h where h.subject_id=any(subjects)),'[]')::text,'UTF8'),'sha256');
  elsif kind in('correction_requests','appeal_intakes') then
   handling:='requester-statements';
   requester_frame:=private.export_account_own_statement_capture_v1(p_account,p_capture)->'classes'->kind;
   n:=(requester_frame->>'rows')::bigint;digest:=decode(requester_frame->>'membershipSha256','hex');counts:=requester_frame->'partitions';
  elsif kind in('ancestry_regions','portrait_results') then
   -- These complete classes are routed independently. Zero here describes
   -- this named legacy subframe, never the actual whole source census.
   handling:='unsupported';n:=0;
  else
   handling:='unsupported';
   case kind
    when 'ancestry_regions' then select count(*) into n from public.ancestry_regions where subject_id=any(subjects);
    when 'appeal_intakes' then select count(*) into n from public.appeal_intakes where appellant_account_id=p_account or appellant_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'correction_requests' then select count(*) into n from public.correction_requests where subject_id=any(subjects) or claimant_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_basis_bindings' then select count(*) into n from public.embryo_basis_bindings where cohort_id=any(cohorts);
    when 'embryo_cohorts' then n:=coalesce(cardinality(cohorts),0);
    when 'embryo_disposition_confirmations' then select count(*) into n from public.embryo_disposition_confirmations c join public.embryo_disposition_proposals p on p.id=c.proposal_id join public.embryos e on e.id=p.embryo_id where e.cohort_id=any(cohorts) or c.confirmer_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_disposition_proposals' then select count(*) into n from public.embryo_disposition_proposals p join public.embryos e on e.id=p.embryo_id where e.cohort_id=any(cohorts) or p.proposer_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_donor_attributions' then select count(*) into n from public.embryo_donor_attributions where cohort_id=any(cohorts) or donor_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_participant_sets' then select count(*) into n from public.embryo_participant_sets where cohort_id=any(cohorts) or principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'family_pairs' then select count(*) into n from public.family_pairs where subject_a_id=any(subjects) or subject_b_id=any(subjects);
    when 'portrait_results' then select count(*) into n from public.portrait_results where owner_account_id=p_account or parent_a_subject_id=any(subjects) or parent_b_subject_id=any(subjects);
    when 'other_adult_held_uploads' then select count(*) into n from public.other_adult_held_uploads where uploader_account_id=p_account or subject_id=any(subjects);
    when 'path_b_report_bindings' then select count(*) into n from private.path_b_report_bindings where recipient_account_id=p_account or subject_id=any(subjects);
    else raise exception using errcode='22023',message='invalid_request';
   end case;
   if n<>0 then raise exception using errcode='0A000',message='export_class_projection_unavailable';end if;
  end if;
  if n is null or n<0 or n>9007199254740991 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  out:=out||jsonb_build_array(jsonb_build_object('kind',kind,'mode',handling,'rows',n,'membershipSha256',encode(digest,'hex'),'partitions',counts));
 end loop;
 return out;
end $$;
revoke all on function private.account_archive_bound_snapshot_v1(jsonb,uuid),
 private.account_archive_legacy_graph_v1(uuid,jsonb),private.account_archive_legacy_classes_v1(uuid,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Report-recipient export permission remains separate from raw.export and
-- the signed variants scope. This uses only the actual export.share-link tuple;
-- each scientific projector must additionally recheck its own signed purpose.
create function private.account_archive_export_recipient_v1(p_origin jsonb,p_subject uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare a uuid;sess uuid;s public.subjects;owner_profile public.profiles;recipient public.subject_principals;
 signer public.subject_principals;b public.subject_account_bindings;relationship public.subject_relationships;
 requested_purpose text;grants jsonb:='[]';value jsonb;consents jsonb;mitigation jsonb;session_receipt jsonb;n bigint;
begin
 if jsonb_typeof(p_origin) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_origin))<>3
  or not(p_origin ?& array['kind','accountId','sessionId']) or p_origin->>'kind' is distinct from 'account' then
  raise exception using errcode='42501',message='not_found';end if;
 a:=(p_origin->>'accountId')::uuid;sess:=(p_origin->>'sessionId')::uuid;
 perform 1 from auth.users where id in(a,(select subject_account_id from public.subjects where id=p_subject)) order by id for share;
 perform 1 from auth.sessions where id=sess and user_id=a for share;
 perform 1 from public.profiles where id in(a,(select subject_account_id from public.subjects where id=p_subject)) order by id for update;
 select * into s from public.subjects where id=p_subject for share;
 if s.id is null or s.subject_class not in('self','other_adult') or s.lifecycle is distinct from 'active'
  or s.subject_account_id is null or s.subject_account_id=a then
  raise exception using errcode='42501',message='not_found';end if;
 session_receipt:=private.family_report_session_v1(a,sess);
 select * into owner_profile from public.profiles where id=s.subject_account_id;
 perform 1 from auth.users where id=owner_profile.id and deleted_at is null
  and (banned_until is null or banned_until<=clock_timestamp());
 if not found or owner_profile.deletion_requested_at is not null or owner_profile.jurisdiction_declared_at is null
  or owner_profile.jurisdiction_code is null or owner_profile.jurisdiction_code='XX' then
  raise exception using errcode='42501',message='not_found';end if;
 perform 1 from public.subject_account_bindings where account_id in(a,s.subject_account_id) order by id for share;
 perform 1 from public.subject_principals where account_id in(a,s.subject_account_id) order by id for share;
 select sp.* into recipient from public.subject_account_bindings rb
  join public.subjects rs on rs.id=rb.subject_id join public.subject_principals sp on sp.id=rb.account_principal_id
  join public.subject_principals rp on rp.id=rb.subject_principal_id
  where rb.account_id=a and rb.status='current' and rb.ended_at is null and rs.subject_class='self'
   and rs.subject_account_id=a and rs.lifecycle in('active','restricted') and sp.status='active'
   and sp.account_id=a and sp.principal_kind='account_subject' and rp.status='active' and rp.account_id=a;
 select * into b from public.subject_account_bindings where subject_id=s.id and account_id=s.subject_account_id
  and status='current' and ended_at is null;
 select * into signer from public.subject_principals where id=b.subject_principal_id and subject_id=s.id
  and account_id=s.subject_account_id and status='active' and principal_kind='account_subject';
 if recipient.id is null or signer.id is null or b.id is null
  or private.family_sharing_paused_v1(s.subject_account_id,a) is distinct from false then
  raise exception using errcode='42501',message='not_found';end if;
 perform 1 from public.subject_relationships where subject_id=s.id order by id for share;
 select * into relationship from public.subject_relationships where subject_id=s.id
  and data_subject_principal_id=signer.id and recipient_principal_id=recipient.id and recipient_account_id=a
  and relationship_kind='family_member' and status='current';
 if relationship.id is null then raise exception using errcode='42501',message='not_found';end if;
 if s.subject_class='other_adult' then
  mitigation:=private.account_archive_other_adult_export_gate_v1(s.id,a);
 end if;
 perform 1 from public.purpose_grants where target_kind='subject' and target_id=s.id order by grant_id for share;
 perform 1 from public.directional_grants where recipient_account_id=a order by grant_id for share;
 perform 1 from public.consent_signatures where target_kind='subject' and target_id=s.id order by id for share;
 perform 1 from public.subject_consents where subject_id=s.id order by id for share;
 perform 1 from public.consent_artifacts where artifact_key in('consent.share-with-adult','consent.upload-self',
  'consent.subject-adult-esignature','consent.subject-adult','consent.raw-export') order by artifact_key,version for share;
 foreach requested_purpose in array array['export.share-link'] loop
  select count(*),jsonb_agg(jsonb_build_object('grant',to_jsonb(g),'direction',to_jsonb(d),
   'signature',to_jsonb(cs),'artifact',to_jsonb(ca)) order by g.grant_id) into n,value
   from public.purpose_grants g join public.directional_grants d on d.grant_id=g.grant_id and d.grant_revision=g.grant_revision
   join public.consent_signatures cs on cs.id=g.signature_id
   join public.consent_artifacts ca on ca.artifact_key=g.artifact_key and ca.version=g.artifact_version
   where g.target_kind='subject' and g.target_id=s.id and g.purpose=requested_purpose
    and g.signer_principal_id=signer.id and g.data_subject_principal_id=signer.id
    and g.subject_binding_revision=s.subject_binding_revision and g.jurisdiction_code=owner_profile.jurisdiction_code
    and g.jurisdiction_revision=owner_profile.jurisdiction_revision and g.revoked_at is null
    and (g.expires_at is null or g.expires_at>clock_timestamp()) and d.status='current' and d.direction='subject_to_recipient'
    and d.recipient_principal_id=recipient.id and d.recipient_account_id=a and d.pair_id is null
    and d.relationship_id=relationship.id and d.relationship_or_pair_revision=relationship.relationship_revision
    and cs.signer_principal_id=signer.id and cs.signer_account_id=s.subject_account_id
    and cs.target_kind=g.target_kind and cs.target_id=g.target_id and cs.purpose=g.purpose
    and cs.subject_binding_revision=g.subject_binding_revision and cs.jurisdiction_code=g.jurisdiction_code
    and cs.jurisdiction_revision=g.jurisdiction_revision and cs.artifact_key=g.artifact_key
    and cs.artifact_version=g.artifact_version and cs.artifact_body_sha256=g.artifact_body_sha256
    and cs.statement_keys=array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time']
    and ca.artifact_key='consent.share-with-adult' and ca.body_sha256=g.artifact_body_sha256
    and ca.superseded_at is null and ca.published_at<=clock_timestamp()
    and ca.effective_on<=timezone('UTC',clock_timestamp())::date
    and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex');
  if n<>1 then raise exception using errcode='42501',message='not_found';end if;
  grants:=grants||value;
 end loop;
 return jsonb_build_object('version','account-complete-export-recipient-v1','origin',p_origin,'session',session_receipt,
  'subject',to_jsonb(s),'subjectBinding',to_jsonb(b),'signer',to_jsonb(signer),'recipient',to_jsonb(recipient),
  'relationship',to_jsonb(relationship),'grants',grants,'mitigation',mitigation);
end $$;

revoke all on function private.account_archive_export_recipient_v1(jsonb,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- These are distinct recipient-authorized raw projectors. They never invoke
-- an own-content reader with the source owner's account/session. The real
-- physical owner is used only in the immutable normalization/source predicate.
create function private.account_archive_raw_file_rows_v1(p_origin jsonb,p_file uuid,p_kind text)
returns table(identity text,subject_id uuid,row_text text)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare source jsonb;f public.genome_files;
begin
 if p_kind is null or p_kind not in('variants','observed','canonical') then
  raise exception using errcode='22023',message='invalid_request';end if;
 source:=private.account_archive_raw_source_v1(p_origin,p_file);
 select * into f from public.genome_files where id=p_file;
 if source#>'{metadata,preparedSource}' is not null then
  raise exception using errcode='55000',message='prepared_object_reader_required';end if;
 if p_kind='variants' then
  return query select v.id::text,f.subject_id,jsonb_build_object('rsid',v.rsid,'chrom',v.chrom,'pos',v.pos,
   'ref',v.ref,'alt',v.alt,'genotype',v.genotype)::text from public.user_variants v
   where v.file_id=f.id and v.subject_id=f.subject_id and v.user_id=f.user_id order by v.id;
 elsif p_kind='observed' then
  return query select v.source_line::text,f.subject_id,jsonb_build_object('source_line',v.source_line,
   'source_sha256',v.source_sha256,'source_build',v.source_build,'source_chrom',v.source_chrom,'source_pos',v.source_pos,
   'source_ref',v.source_ref,'source_alt',v.source_alt,'source_gt',v.source_gt,'rsid',v.rsid,'chrom',v.chrom,'pos',v.pos,
   'ref',v.ref,'alt',v.alt,'genotype',v.genotype,'quality_state',v.quality_state,'usable',v.usable)::text
   from public.report_observed_calls v where v.file_id=f.id and v.subject_id=f.subject_id and v.user_id=f.user_id
    and v.source_sha256=f.sha256 and v.source_build=f.build and v.extraction_version='vcf-literal-diploid-snp-v1'
   order by v.source_line;
 end if;
 -- A DB-normalized original cannot be represented as a retired prepared
 -- canonical source. Its explicit empty canonical receipt is a backend fact.
 if private.account_archive_raw_source_v1(p_origin,p_file) is distinct from source then
  raise exception using errcode='42501',message='not_found';end if;
end $$;

create function private.account_archive_raw_file_inventory_v1(p_origin jsonb,p_file uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare source jsonb;f public.genome_files;kind text;item record;n bigint;digest bytea;content jsonb;parts jsonb:='[]';
begin
 source:=private.account_archive_raw_source_v1(p_origin,p_file);
 select * into f from public.genome_files where id=p_file;
 if source#>'{metadata,preparedSource}' is null then
  foreach kind in array array['variants','observed','canonical'] loop
   digest:=extensions.digest(convert_to('account-complete-file-v1|'||f.id::text||'|'||kind,'UTF8'),'sha256');n:=0;
   for item in select * from private.account_archive_raw_file_rows_v1(p_origin,f.id,kind) r
    order by jsonb_build_array(f.id::text,r.identity)::text collate "C" loop
    if item.subject_id is distinct from f.subject_id then raise exception using errcode='55000',message='export_source_unavailable';end if;
    digest:=extensions.digest(digest||convert_to(item.identity||':'||item.subject_id::text||':'||item.row_text||E'\n','UTF8'),'sha256');
    n:=n+1;if n>9007199254740991 then raise exception using errcode='55000',message='export_source_unavailable';end if;
   end loop;
   parts:=parts||jsonb_build_array(jsonb_build_object('kind',kind,'rows',n,'membershipSha256',encode(digest,'hex')));
  end loop;
  if (source#>>'{originalFrame,state,retired}')::boolean is distinct from false then
   raise exception using errcode='42501',message='not_found';end if;
  content:=jsonb_build_object('backend','database-v1','receipts',parts);
 else
  -- Provider-only canonical rows have no invented SQL plaintext digest.
  -- Their complete immutable root/member receipts and materialization EOF are
  -- checked by the established canonical streaming reader, under this door.
  content:=jsonb_build_object('backend','prepared-object-v1','source',source->'preparedManifest');
 end if;
 if private.account_archive_raw_source_v1(p_origin,p_file) is distinct from source then
  raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('fileId',f.id,'subjectId',f.subject_id,'originalName',f.original_name,'fileType',f.file_type,
  'sourceRevision',f.upload_revision,'sizeBytes',f.size_bytes,'rawSha256',f.sha256,'decodedSha256',f.source_sha256,
  'rawAuthoritySha256',encode(extensions.digest(convert_to((source->'rawAuthority')::text,'UTF8'),'sha256'),'hex'),
  'originalRetired',source#>'{originalFrame,state,retired}','content',content);
end $$;

create function private.account_archive_raw_prepared_member_v1(p_origin jsonb,p_file uuid,p_manifest uuid,p_artifact uuid,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare source jsonb;m private.own_prepared_manifests;a private.own_preparation_artifacts;value jsonb;
begin
 if p_manifest is null or p_artifact is null or jsonb_typeof(p_expected) is distinct from 'object'
  or octet_length(p_expected::text)>8192 then raise exception using errcode='22023',message='invalid_request';end if;
 source:=private.account_archive_raw_source_v1(p_origin,p_file);
 if source#>>'{metadata,preparedSource,manifestId}' is distinct from p_manifest::text then
  raise exception using errcode='42501',message='not_found';end if;
 select * into m from private.own_prepared_manifests where id=p_manifest and file_id=p_file for share;
 select artifact.* into a from private.own_prepared_manifest_members member
  join private.own_preparation_artifacts artifact on artifact.id=member.artifact_id
  where member.manifest_id=m.id and member.artifact_id=p_artifact for share of member,artifact;
 if m.id is null or a.id is null or a.job_id is distinct from m.job_id or a.attempt_id is distinct from m.attempt_id
  or a.state is distinct from 'acknowledged' or a.observed_sha256 is distinct from a.sha256 then
  raise exception using errcode='42501',message='not_found';end if;
 perform private.own_preparation_artifact_current_v1(a.id,true);
 value:=private.own_preparation_stored_artifact_v1(a);
 if value is distinct from p_expected or private.account_archive_raw_source_v1(p_origin,p_file) is distinct from source then
  raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('version','own-prepared-member-v1','manifestId',m.id,'fileId',m.file_id,
  'membershipSha256',m.membership_sha256,'member',value);
end $$;
revoke all on function private.account_archive_raw_file_rows_v1(jsonb,uuid,text),
 private.account_archive_raw_file_inventory_v1(jsonb,uuid),private.account_archive_raw_prepared_member_v1(jsonb,uuid,uuid,uuid,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Static derivative of the exact readable base. The old account-wide
-- unsupported-source refusal is replaced only in this distinct complete door;
-- all own/Path B/claimed-bound partition authority is retained. Other sources
-- are enumerated with explicit dispositions by the complete capture below.
create function private.account_archive_legacy_base_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare a uuid;s record;current_part jsonb;base jsonb;parts jsonb:='[]';ids jsonb:='[]';
 frame jsonb;files bigint:=0;receipt text;
begin
 if jsonb_typeof(p_origin) is distinct from 'object' or p_origin->>'kind' is distinct from 'account'
  or (select count(*) from jsonb_object_keys(p_origin))<>3 or not(p_origin ?& array['kind','accountId','sessionId'])
  or p_target_kind not in('account','subject') or p_target_kind is null or p_target_id is null then
  raise exception using errcode='42501',message='not_found';end if;
 a:=(p_origin->>'accountId')::uuid;
 if p_target_kind='account' then
  if p_target_id<>a then raise exception using errcode='42501',message='not_found';end if;


 end if;
 for s in select * from public.subjects where subject_account_id=a and lifecycle<>'purged'
  and (p_target_kind='account' or id=p_target_id) order by id for share loop
  if s.subject_class in('self','other_adult') then
   current_part:=case when p_target_kind='account' and exists(select 1 from public.genome_files gf
    where gf.subject_id=s.id and private.export_account_path_b_file_v1(gf.id))
    then private.export_account_ordinary_readable_authority_v1(p_origin,'subject',s.id)
    else private.export_archive_ordinary_account_authority_v1(p_origin,'subject',s.id) end;
   parts:=parts||jsonb_build_array(jsonb_build_object('subjectId',s.id,'class','ordinary','capture',current_part));
   files:=files+(current_part->>'fileCount')::bigint;
   if s.subject_class='self' and base is null then base:=current_part;end if;
  elsif s.subject_class='embryo' and s.lifecycle='claimed_bound' and s.owner_account_id=a then
   current_part:=private.account_archive_bound_snapshot_v1(p_origin,s.id);
   parts:=parts||jsonb_build_array(jsonb_build_object('subjectId',s.id,'class','claimed-bound','capture',current_part));
   files:=files+1;
  else raise exception using errcode='0A000',message='export_partition_projection_unavailable';end if;
  ids:=ids||jsonb_build_array(s.id);
 end loop;
 if jsonb_array_length(parts)=0 then raise exception using errcode='42501',message='not_found';end if;
 -- A genuine current self account principal remains the account origin anchor.
 if base is null then
  select subj.id into s from public.subjects subj where subj.subject_account_id=a and subj.subject_class='self'
   and subj.lifecycle in('active','restricted') order by subj.id limit 1;
  if s.id is null then raise exception using errcode='42501',message='not_found';end if;
  base:=private.export_archive_ordinary_account_authority_v1(p_origin,'subject',s.id);
 end if;
 frame:=jsonb_build_object('version','owned-account-archive-v1','origin',p_origin,'targetKind',p_target_kind,
  'targetId',p_target_id,'partitions',parts,
  'legacyConsents',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.consent_grants c where c.user_id=a),
  'providerRecipients',(select coalesce(jsonb_agg(to_jsonb(g) order by g.id),'[]') from public.provider_recipient_grants g where g.account_id=a),
  'principals',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.subject_principals p where p.account_id=a),
  'bindings',(select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]') from public.subject_account_bindings b where b.account_id=a),
  'consents',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.subject_consents c where c.account_id=a),
  'signatures',(select coalesce(jsonb_agg(to_jsonb(sig) order by sig.id),'[]') from public.consent_signatures sig where sig.signer_account_id=a),
  'attestations',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.attestations t
    where t.principal_id in(select id from public.subject_principals where account_id=a)
     or t.signature_id in(select id from public.consent_signatures where signer_account_id=a)),
  'legalAudit',(select coalesce(jsonb_agg(to_jsonb(l) order by l.seq),'[]') from public.legal_audit_log l
    join private.legal_audit_account_principals m on m.audit_principal_id=l.audit_principal_id where m.account_id=a));
 receipt:=encode(extensions.digest(frame::text,'sha256'),'hex');
 return jsonb_build_object('authority',base||jsonb_build_object('authorityReceipt',receipt,'subjectPartitions',ids,'fileCount',files),
  'partitions',parts);
end $$;
revoke all on function private.account_archive_legacy_base_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.account_archive_legacy_capture_v1(p_origin jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare a uuid;captured jsonb;subjects uuid[];item record;source jsonb;originals jsonb:='[]';path_b jsonb:='[]';
 frame jsonb;receipt text;
begin
 a:=(p_origin->>'accountId')::uuid;
 captured:=private.account_archive_legacy_base_v1(p_origin,'account',a);
 select array_agg(x::uuid order by x) into subjects
  from jsonb_array_elements_text(captured#>'{authority,subjectPartitions}')x;
 for item in select gf.id from public.genome_files gf where gf.subject_id=any(subjects)
  and exists(select 1 from jsonb_array_elements(captured->'partitions')part
   where part->>'class'='ordinary' and part->>'subjectId'=gf.subject_id::text)
  and not private.export_account_path_b_file_v1(gf.id) order by gf.id loop
  source:=private.own_export_source_v1(a,(p_origin->>'sessionId')::uuid,item.id);
  if source is null then raise exception using errcode='42501',message='not_found';end if;
  originals:=originals||jsonb_build_array(private.export_account_original_frame_v1(item.id,source ? 'preparedSource'));
 end loop;
 for item in select subj.id from public.subjects subj where subj.id=any(subjects)
  and subj.subject_class='other_adult' and exists(select 1 from public.genome_files gf
   where gf.subject_id=subj.id and private.export_account_path_b_file_v1(gf.id)) order by subj.id loop
  path_b:=path_b||jsonb_build_array(private.export_account_path_b_snapshot_v1(p_origin,item.id));
 end loop;
 captured:=captured||jsonb_build_object('originalFrames',originals,'pathBResults',path_b,
  'memberInventory',private.export_account_history_inventory_v1(a,subjects));
 captured:=captured||jsonb_build_object('readableGraph',private.account_archive_legacy_graph_v1(a,captured));
 captured:=captured||jsonb_build_object('ownStatements',private.export_account_own_statement_capture_v1(a,captured));
 captured:=captured||jsonb_build_object('classInventory',private.account_archive_legacy_classes_v1(a,captured));
 -- These are the original account-wide member-frame inputs, including whole
 -- signatures/contact bindings internally. They never enter a public DTO.
 frame:=jsonb_build_object('version','account-complete-legacy-source-v1','capture',captured,
  'profile',(select to_jsonb(p) from public.profiles p where p.id=a),
  'demographics',(select coalesce(jsonb_agg(to_jsonb(d) order by d.subject_id),'[]') from public.subject_demographics d
   where d.subject_id=any(subjects)),
  'ownPurposeGrants',(select coalesce(jsonb_agg(to_jsonb(g) order by g.grant_id),'[]') from public.purpose_grants g
   join public.consent_signatures sig on sig.id=g.signature_id where g.target_kind='subject' and g.target_id=any(subjects)
    and sig.signer_account_id=a),
  'fileContentRevisions',(select coalesce(jsonb_agg(jsonb_build_object('fileId',gf.id,'revision',gf.export_content_revision)
   order by gf.id),'[]') from public.genome_files gf where gf.subject_id=any(subjects)),
  'legacyConsents',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.consent_grants c where c.user_id=a),
  'providerRecipients',(select coalesce(jsonb_agg(to_jsonb(g) order by g.id),'[]') from public.provider_recipient_grants g where g.account_id=a),
  'principals',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.subject_principals p where p.account_id=a),
  'bindings',(select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]') from public.subject_account_bindings b where b.account_id=a),
  'consents',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.subject_consents c where c.account_id=a),
  'signatures',(select coalesce(jsonb_agg(to_jsonb(sig) order by sig.id),'[]') from public.consent_signatures sig where sig.signer_account_id=a),
  'attestations',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.attestations t
   where t.principal_id in(select id from public.subject_principals where account_id=a)
    or t.signature_id in(select id from public.consent_signatures where signer_account_id=a)),
  'legalAudit',(select coalesce(jsonb_agg(to_jsonb(l) order by l.seq),'[]') from public.legal_audit_log l
   join private.legal_audit_account_principals m on m.audit_principal_id=l.audit_principal_id where m.account_id=a));
 receipt:=encode(extensions.digest(convert_to(frame::text,'UTF8'),'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('legacySource',frame);
end $$;
revoke all on function private.account_archive_legacy_capture_v1(jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.account_archive_complete_class_kinds_v1() returns text[]
language sql immutable set search_path='' as $$ select array[
 'ancestry_regions','appeal_intakes','attestation_contradictions','correction_requests','directional_grants',
 'embryo_basis_bindings','embryo_cohorts','embryo_disposition_confirmations','embryo_disposition_proposals','embryo_donor_attributions',
 'embryo_figures','embryo_participant_sets','embryo_qc','embryo_scores','embryo_variants','embryos','family_pairs',
 'family_sharing_pauses','family_sharing_stops','future_person_claim_objections','future_person_claimant_principals',
 'future_person_claims','portrait_results','report_artifacts','subject_control_refusal_authorities','subject_relationships',
 'suppressions','other_adult_held_uploads','path_b_report_bindings']::text[] $$;

-- Server scope discovery is not an entitlement. Every association is retained,
-- including ended parent sets and held uploads; each payload class separately
-- records its actual permission disposition. No caller selects a subset.
create function private.account_archive_complete_subjects_v1(p_origin jsonb) returns uuid[]
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare a uuid;ids uuid[];
begin
 a:=(p_origin->>'accountId')::uuid;
 perform private.future_person_archive_account_actor_v1(a,(p_origin->>'sessionId')::uuid);
 select coalesce(array_agg(s.id order by s.id),'{}'::uuid[]) into ids from public.subjects s
  where s.lifecycle<>'purged' and (s.owner_account_id=a or s.subject_account_id=a
   or exists(select 1 from public.directional_grants d join public.purpose_grants g using(grant_id)
    where d.recipient_account_id=a and g.target_kind='subject' and g.target_id=s.id)
   or exists(select 1 from public.embryos e join public.embryo_cohorts c on c.id=e.cohort_id
    where e.subject_id=s.id and (c.owner_account_id=a or exists(select 1 from public.embryo_participant_sets ps
     join public.subject_principals sp on sp.id=ps.principal_id where ps.cohort_id=c.id and sp.account_id=a)))
   or exists(select 1 from public.family_pairs pair join public.subjects counterpart
    on counterpart.id=case when pair.subject_a_id=s.id then pair.subject_b_id else pair.subject_a_id end
    where s.id in(pair.subject_a_id,pair.subject_b_id) and counterpart.subject_account_id=a));
 perform 1 from public.subjects where id=any(ids) order by id for share;
 return ids;
end $$;

-- Complete internal source census. These whole rows are hashed before any
-- disposition; they are not returned as archive payloads. All SQL branches are
-- fixed here. Parent variants remain internal and never gain raw permission.
create function private.account_archive_complete_source_rows_v1(p_account uuid,p_subjects uuid[],p_kind text,p_legacy_subjects uuid[] default null)
returns table(identity text,subject_id uuid,source_row jsonb)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare cohorts uuid[];query text;anchor uuid;
begin
 if p_kind is null or not(p_kind=any(private.account_archive_complete_class_kinds_v1())) then
  raise exception using errcode='22023',message='invalid_request';end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into cohorts from(
  select c.id from public.embryo_cohorts c where c.owner_account_id=p_account
  union select ps.cohort_id from public.embryo_participant_sets ps
   join public.subject_principals sp on sp.id=ps.principal_id where sp.account_id=p_account
  union select e.cohort_id from public.embryos e where e.subject_id=any(p_subjects)) scope;
 if p_kind in('embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
  'embryo_disposition_proposals','embryo_disposition_confirmations','family_pairs') then
  select s.id into anchor from public.subjects s where s.id=any(p_subjects) and s.subject_class='self'
   and s.subject_account_id=p_account and s.lifecycle in('active','restricted') for share;
  if anchor is null then raise exception using errcode='42501',message='not_found';end if;
  return query select private.export_account_graph_cursor_v1(p_kind,r.projected_key),anchor,r.projected_row
   from private.export_account_graph_projection_v1(p_account,p_subjects,p_kind) r;
  return;
 elsif p_kind in('appeal_intakes','correction_requests') then
  return query select r.id::text,r.subject_id,to_jsonb(r)
   from private.export_account_requester_rows_v1(p_account,p_subjects) r
   where r.case_kind=case when p_kind='appeal_intakes' then 'appeal' else 'correction' end;
  return;
 end if;
 case p_kind
 when 'ancestry_regions' then query:='select concat(r.ancestry_result_id,'':'',r.region_code),r.subject_id,to_jsonb(r) from public.ancestry_regions r where r.subject_id=any($1)';
 when 'portrait_results' then query:='select r.id::text,case when sa.subject_account_id=$3 then r.parent_b_subject_id when sb.subject_account_id=$3 then r.parent_a_subject_id when r.parent_a_subject_id=any($1) then r.parent_a_subject_id else r.parent_b_subject_id end,to_jsonb(r) from public.portrait_results r join public.subjects sa on sa.id=r.parent_a_subject_id join public.subjects sb on sb.id=r.parent_b_subject_id where r.owner_account_id=$3 or r.parent_a_subject_id=any($1) or r.parent_b_subject_id=any($1)';
 when 'embryos' then query:='select r.id::text,r.subject_id,to_jsonb(r) from public.embryos r where r.subject_id=any($1) or r.cohort_id=any($2)';
 when 'embryo_qc' then query:='select r.embryo_id::text,e.subject_id,to_jsonb(r) from public.embryo_qc r join public.embryos e on e.id=r.embryo_id where e.subject_id=any($1) or e.cohort_id=any($2)';
 when 'embryo_scores' then query:='select r.id::text,e.subject_id,to_jsonb(r) from public.embryo_scores r join public.embryos e on e.id=r.embryo_id where e.subject_id=any($1) or e.cohort_id=any($2)';
 when 'embryo_figures' then query:='select r.id::text,e.subject_id,to_jsonb(r) from public.embryo_figures r join public.embryo_scores score on score.id=r.finding_id join public.embryos e on e.id=score.embryo_id where e.subject_id=any($1) or e.cohort_id=any($2)';
 when 'embryo_variants' then query:='select r.id::text,e.subject_id,to_jsonb(r) from public.embryo_variants r join public.embryos e on e.id=r.embryo_id where e.subject_id=any($1) or e.cohort_id=any($2)';
 when 'report_artifacts' then query:='select r.id::text,r.subject_id,to_jsonb(r) from public.report_artifacts r where r.subject_id=any($1) or r.cohort_id=any($2)';
 when 'other_adult_held_uploads' then query:='select r.id::text,r.subject_id,to_jsonb(r) from public.other_adult_held_uploads r where r.uploader_account_id=$3 or r.subject_id=any($1)';
 when 'path_b_report_bindings' then query:='select r.id::text,r.subject_id,to_jsonb(r) from private.path_b_report_bindings r where r.recipient_account_id=$3 or r.subject_id=any($1)';
 else
  -- For the ten existing requester metadata classes the named original
  -- projector is itself the scope contract; private capsules never escape.
  -- Existing account-level legacy metadata keeps its exact NULL/subject
  -- attribution. Only genuinely new identities use the routed subject.
  return query select r.projected_id::text,case when old.projected_id is not null then old.projected_subject else r.projected_subject end,r.projected_row
   from private.export_account_class_projection_v1(p_account,p_subjects,p_kind) r
   left join private.export_account_class_projection_v1(p_account,coalesce(p_legacy_subjects,p_subjects),p_kind) old
    on old.projected_id=r.projected_id;
  return;
 end case;
 return query execute query using p_subjects,cohorts,p_account;
end $$;
revoke all on function private.account_archive_complete_class_kinds_v1(),
 private.account_archive_complete_subjects_v1(jsonb),
 private.account_archive_complete_source_rows_v1(uuid,uuid[],text,uuid[])
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.account_archive_complete_subject_authority_v1(p_origin jsonb,p_subject uuid,p_legacy jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare a uuid;s public.subjects;part jsonb;recipient jsonb;raw jsonb;grants jsonb;files jsonb;
begin
 a:=(p_origin->>'accountId')::uuid;
 select * into s from public.subjects where id=p_subject for share;
 if s.id is null or s.lifecycle='purged' then raise exception using errcode='42501',message='not_found';end if;
 select x into part from jsonb_array_elements(p_legacy->'partitions')x where x->>'subjectId'=s.id::text;
 if part is not null then
  return jsonb_build_object('subjectId',s.id,'class',part->'class','status','permitted',
   'reason',case when part->>'class'='claimed-bound' then 'claimed-bound' else 'own-subject' end,
   'authority',part->'capture','rawAuthority',null);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('grant',to_jsonb(g),'direction',to_jsonb(d)) order by g.grant_id),'[]')
  into grants from public.purpose_grants g join public.directional_grants d using(grant_id)
  where g.target_kind='subject' and g.target_id=s.id and d.recipient_account_id=a;
 -- No current export permission is an explicit disposition, not an analytical
 -- grant substitute. If a live candidate exists, the exact full signed tuple
 -- must validate; an invalid/stale candidate is a refusal, never an omission.
 if s.subject_class in('self','other_adult') and exists(select 1 from public.purpose_grants g
  join public.directional_grants d using(grant_id) where g.target_kind='subject' and g.target_id=s.id
   and g.purpose='export.share-link' and d.recipient_account_id=a and d.status='current'
   and g.revoked_at is null and(g.expires_at is null or g.expires_at>clock_timestamp())) then
  recipient:=private.account_archive_export_recipient_v1(p_origin,s.id);
  if exists(select 1 from public.purpose_grants g join public.directional_grants d using(grant_id)
   where g.target_kind='subject' and g.target_id=s.id and g.purpose='raw.export' and d.recipient_account_id=a
    and d.status='current' and g.revoked_at is null and(g.expires_at is null or g.expires_at>clock_timestamp())) then
   raw:=private.account_archive_raw_authority_v1(p_origin,s.id);
  end if;
 end if;
 -- File metadata/revisions and all actual grants are internal source inputs.
 -- No other subject's original/call row is emitted without rawAuthority.
 select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]') into files from public.genome_files f where f.subject_id=s.id;
 return jsonb_build_object('subjectId',s.id,'class','consent-covered',
  'status',case when recipient is null then 'excluded' else 'permitted' end,
  'reason',case when recipient is null then 'export-recipient-consent-required' else 'signed-report-export' end,
  'authority',jsonb_build_object('subject',to_jsonb(s),'grants',grants,'recipient',recipient,'files',files),
  'rawAuthority',raw);
end $$;

-- Full ancestry rows and saved portrait/report artifacts are routed explicitly.
-- Metadata supplements reuse the exact named, minimized original projectors.
-- Parent science is not made exportable by physical ownership or analysis-only
-- consent: its exhaustive source census/disposition remains visible instead.
create function private.account_archive_complete_class_rows_v1(p_origin jsonb,p_legacy jsonb,p_permissions jsonb,p_kind text)
returns table(identity text,subject_id uuid,row_text text)
language plpgsql security definer set search_path='' set lock_timeout='250ms' set extra_float_digits=3 as $$
declare a uuid;sess uuid;subjects uuid[];legacy_subjects uuid[];r record;permission jsonb;direction jsonb;source_authority jsonb;
 source_file public.genome_files;
 counterpart uuid;pair_authority jsonb;readiness jsonb;sid uuid;
begin
 if p_kind is null or not(p_kind=any(private.account_archive_complete_class_kinds_v1())) then
  raise exception using errcode='22023',message='invalid_request';end if;
 a:=(p_origin->>'accountId')::uuid;sess:=(p_origin->>'sessionId')::uuid;
 select coalesce(array_agg((x->>'subjectId')::uuid order by x->>'subjectId'),'{}'::uuid[])
  into subjects from jsonb_array_elements(p_permissions)x;
 select coalesce(array_agg((x->>'subjectId')::uuid order by x->>'subjectId'),'{}'::uuid[])
  into legacy_subjects from jsonb_array_elements(p_legacy->'partitions')x;
 if p_kind='ancestry_regions' then
  for r in select ar.* from public.ancestry_regions ar where ar.subject_id=any(subjects)
   order by ar.ancestry_result_id,ar.region_code for share loop
   select x into permission from jsonb_array_elements(p_permissions)x where x->>'subjectId'=r.subject_id::text;
   if permission->>'status'='permitted' then
    if permission->>'class'='consent-covered' then
     direction:=private.family_ancestry_recipient_v1(a,sess,r.subject_id,'ancestry');
     if direction is null then raise exception using errcode='42501',message='not_found';end if;
     select f.* into source_file from public.ancestry_results result join public.genome_files f on f.id=result.file_id
      where result.id=r.ancestry_result_id and result.subject_id=r.subject_id and result.user_id=f.user_id
       and f.subject_id=r.subject_id for share of result,f;
     if source_file.id is null then raise exception using errcode='42501',message='not_found';end if;
     source_authority:=private.family_source_ancestry_authority_v1(source_file.user_id,source_file.id);
     if private.own_analysis_completion_matches_v1(source_file.id,'ancestry',source_authority) is not true then
      raise exception using errcode='42501',message='not_found';end if;
    end if;
    identity:=r.ancestry_result_id::text||':'||r.region_code;subject_id:=r.subject_id;row_text:=to_jsonb(r)::text;return next;
   end if;
  end loop;
 elsif p_kind='portrait_results' then
  for r in select pr.* from public.portrait_results pr where pr.owner_account_id=a
   or pr.parent_a_subject_id=any(subjects) or pr.parent_b_subject_id=any(subjects) order by pr.id for share loop
   select case when sa.subject_account_id=a then sb.subject_account_id when sb.subject_account_id=a then sa.subject_account_id end
    into counterpart from public.subjects sa join public.subjects sb on sb.id=r.parent_b_subject_id where sa.id=r.parent_a_subject_id;
   if counterpart is null then continue;end if;
   pair_authority:=private.family_portrait_authority_v1(a,sess,r.family_pair_id,counterpart);
   if pair_authority is null then continue;end if;
   sid:=case when pair_authority#>>'{subjectA,accountId}'=a::text then r.parent_b_subject_id else r.parent_a_subject_id end;
   select x into permission from jsonb_array_elements(p_permissions)x where x->>'subjectId'=sid::text;
   if permission->>'status' is distinct from 'permitted' or permission->>'class' is distinct from 'consent-covered' then continue;end if;
   -- Actual source readiness and mutual grants are necessary in addition to
   -- the counterpart's separate current signed export-recipient permission.
   readiness:=public.family_portrait_source_readiness_v1(a,sess,r.family_pair_id,counterpart,null);
   if readiness is null or private.family_portrait_authority_v1(a,sess,r.family_pair_id,counterpart) is distinct from pair_authority then
    raise exception using errcode='42501',message='not_found';end if;
   identity:=r.id::text;subject_id:=sid;row_text:=to_jsonb(r)::text;return next;
  end loop;
 elsif p_kind='report_artifacts' then
  for r in select report.* from public.report_artifacts report where report.subject_id=any(subjects)
   order by report.id for share loop
   select x into permission from jsonb_array_elements(p_permissions)x where x->>'subjectId'=r.subject_id::text;
   -- Claimed-bound rows already belong to the original named legacy receipt.
   if permission->>'status'='permitted' and permission->>'class'='ordinary' then
    identity:=r.id::text;subject_id:=r.subject_id;row_text:=to_jsonb(r)::text;return next;
   end if;
  end loop;
 elsif p_kind in('attestation_contradictions','directional_grants','family_sharing_pauses','family_sharing_stops',
  'future_person_claim_objections','future_person_claimant_principals','future_person_claims',
  'subject_control_refusal_authorities','subject_relationships','suppressions') then
  return query select r.projected_id::text,r.projected_subject,r.projected_row::text
   from private.export_account_class_projection_v1(a,subjects,p_kind) r
   where not exists(select 1 from private.export_account_class_projection_v1(a,legacy_subjects,p_kind) old
    where old.projected_id=r.projected_id);
 end if;
end $$;
revoke all on function private.account_archive_complete_subject_authority_v1(jsonb,uuid,jsonb),
 private.account_archive_complete_class_rows_v1(jsonb,jsonb,jsonb,text)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.account_archive_complete_class_census_v1(p_origin jsonb,p_legacy jsonb,p_permissions jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare a uuid;subjects uuid[];kind text;r record;old jsonb;classes jsonb:='[]';sources jsonb:='[]';
 dispositions jsonb:='[]';permission jsonb;source_digest bytea;routed_digest bytea;source_count bigint;
 routed_count bigint;old_emitted bigint;source_counts jsonb;routed_counts jsonb;parts jsonb;subject_key text;
 whole text;source_n bigint;emitted_n bigint;
begin
 a:=(p_origin->>'accountId')::uuid;
 select coalesce(array_agg((x->>'subjectId')::uuid order by x->>'subjectId'),'{}'::uuid[])
  into subjects from jsonb_array_elements(p_permissions)x;
 foreach kind in array private.account_archive_complete_class_kinds_v1() loop
  select x into old from jsonb_array_elements(p_legacy->'classInventory')x where x->>'kind'=kind;
  if old is null then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  source_digest:=extensions.digest(convert_to('account-complete-source-class-v1|'||kind,'UTF8'),'sha256');
  routed_digest:=extensions.digest(convert_to('account-complete-routed-v1|'||kind,'UTF8'),'sha256');
  source_count:=0;routed_count:=0;source_counts:='{}';routed_counts:='{}';
  for r in select * from private.account_archive_complete_source_rows_v1(a,subjects,kind,
   array(select(x->>'subjectId')::uuid from jsonb_array_elements(p_legacy->'partitions')x)) row
   order by jsonb_build_array(row.subject_id,row.identity)::text collate "C" loop
   if r.identity is null or r.source_row is null then raise exception using errcode='55000',message='export_source_unavailable';end if;
   source_count:=source_count+1;subject_key:=coalesce(r.subject_id::text,'account');
   source_counts:=jsonb_set(source_counts,array[subject_key],to_jsonb(coalesce((source_counts->>subject_key)::bigint,0)+1),true);
   source_digest:=extensions.digest(source_digest||convert_to(r.identity||':'||coalesce(r.subject_id::text,'')||':'||r.source_row::text||E'\n','UTF8'),'sha256');
  end loop;
  for r in select * from private.account_archive_complete_class_rows_v1(p_origin,p_legacy,p_permissions,kind) row
   order by jsonb_build_array(row.subject_id,row.identity)::text collate "C" loop
   if r.identity is null or r.row_text is null then raise exception using errcode='55000',message='export_source_unavailable';end if;
   routed_count:=routed_count+1;subject_key:=coalesce(r.subject_id::text,'account');
   routed_counts:=jsonb_set(routed_counts,array[subject_key],to_jsonb(coalesce((routed_counts->>subject_key)::bigint,0)+1),true);
   routed_digest:=extensions.digest(routed_digest||convert_to(r.identity||':'||coalesce(r.subject_id::text,'')||':'||r.row_text||E'\n','UTF8'),'sha256');
  end loop;
  if source_count>9007199254740991 or routed_count>source_count then raise exception using errcode='55000',message='export_source_unavailable';end if;
  select coalesce(jsonb_agg(jsonb_build_object('subjectId',case when key='account' then null else key end,'rows',value::bigint)
   order by key collate "C"),'[]') into parts from jsonb_each_text(routed_counts);
  old_emitted:=case when old->>'mode'='excluded' then 0 else(old->>'rows')::bigint end;
  whole:=encode(extensions.digest(convert_to('account-complete-class-v1|'||kind||E'\n'||(old->>'rows')||':'||
   (old->>'membershipSha256')||E'\n'||routed_count::text||':'||encode(routed_digest,'hex')||E'\n','UTF8'),'sha256'),'hex');
  select coalesce(jsonb_agg(jsonb_build_object('subjectId',subject,'rows',n) order by subject),'[]') into parts from(
   select x->>'subjectId' subject,sum((x->>'rows')::bigint) n
   from jsonb_array_elements((case when old->>'mode'='excluded' then '[]'::jsonb else old->'partitions' end)||parts)x
   group by x->>'subjectId') merged;
  classes:=classes||jsonb_build_array(jsonb_build_object('kind',kind,'rows',old_emitted+routed_count,
   'membershipSha256',whole,'partitions',parts,
   'legacy',jsonb_build_object('rows',old->'rows','membershipSha256',old->'membershipSha256','partitions',old->'partitions'),
   'routed',jsonb_build_object('rows',routed_count,'membershipSha256',encode(routed_digest,'hex'),'partitions',
    coalesce((select jsonb_agg(jsonb_build_object('subjectId',key,'rows',value::bigint) order by key)
     from jsonb_each_text(routed_counts) where key<>'account'),'[]'))));
  sources:=sources||jsonb_build_array(jsonb_build_object('kind',kind,'rows',source_count,
   'membershipSha256',encode(source_digest,'hex'),'partitions',source_counts));
  for permission in select x from jsonb_array_elements(p_permissions)x order by x->>'subjectId' loop
   subject_key:=permission->>'subjectId';source_n:=coalesce((source_counts->>subject_key)::bigint,0);
   emitted_n:=coalesce((routed_counts->>subject_key)::bigint,0)+coalesce((select sum((x->>'rows')::bigint)
    from jsonb_array_elements(old->'partitions')x where x->>'subjectId'=subject_key and old->>'mode'<>'excluded'),0);
   if emitted_n>source_n then raise exception using errcode='55000',message='export_source_unavailable';end if;
   dispositions:=dispositions||jsonb_build_array(jsonb_build_object('subjectId',permission->'subjectId','kind',kind,
    'sourceRows',source_n,'exportRows',emitted_n,'status',case when emitted_n>0 or(source_n=0 and permission->>'status'='permitted') then 'permitted' else 'excluded' end,
    'reason',case when emitted_n>0 or(source_n=0 and permission->>'status'='permitted') then permission->>'reason'
     when kind='embryo_variants' or kind='other_adult_held_uploads' then 'separate-raw-export-authority-required'
     when permission->>'class'='consent-covered' then 'export-recipient-consent-required' else 'outside-consent-scope' end,
    'authoritySha256',encode(extensions.digest(convert_to(permission::text,'UTF8'),'sha256'),'hex')));
  end loop;
  source_n:=coalesce((source_counts->>'account')::bigint,0);emitted_n:=coalesce((routed_counts->>'account')::bigint,0)
   +old_emitted-coalesce((select sum((x->>'rows')::bigint) from jsonb_array_elements(old->'partitions')x
    where old->>'mode'<>'excluded'),0);
  if emitted_n>source_n then raise exception using errcode='55000',message='export_source_unavailable';end if;
  if source_n>0 or emitted_n>0 then
   dispositions:=dispositions||jsonb_build_array(jsonb_build_object('subjectId',null,'kind',kind,'sourceRows',source_n,
    'exportRows',emitted_n,'status',case when emitted_n>0 or source_n=0 then 'permitted' else 'excluded' end,
    'reason',case when emitted_n>0 or source_n=0 then 'requester-metadata' else 'outside-consent-scope' end,
    'authoritySha256',p_legacy#>'{authority,authorityReceipt}'));
  end if;
 end loop;
 return jsonb_build_object('classes',classes,'sources',sources,'dispositions',dispositions);
end $$;
revoke all on function private.account_archive_complete_class_census_v1(jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.account_archive_complete_member_names_v1() returns text[]
language sql immutable set search_path='' as $$ select array['subject.json','consents.json','legacy-consents.json',
 'attestations.json','audit-log.json','reports.json','reports.txt','prs.json','ancestry.json','chats.json','portrait.json','embryos.json']::text[] $$;

-- The recipient is the real actor. Stored completed runs are read only after
-- the separate export tuple and the precise current scientific purpose/source
-- authority succeed. No owner session, raw PRS score or new report is created.
create function private.account_archive_related_science_rows_v1(p_origin jsonb,p_subject uuid,p_member text)
returns table(identity text,row_text text)
language plpgsql security definer set search_path='' set lock_timeout='250ms' set extra_float_digits=3 as $$
declare a uuid;sess uuid;purpose text;direction jsonb;authority jsonb;r private.own_analysis_runs;
 f public.genome_files;item record;value jsonb;
begin
 if p_member not in('reports.json','reports.txt','prs.json','ancestry.json') or p_member is null then
  raise exception using errcode='22023',message='invalid_request';end if;
 a:=(p_origin->>'accountId')::uuid;sess:=(p_origin->>'sessionId')::uuid;
 perform private.account_archive_export_recipient_v1(p_origin,p_subject);
 foreach purpose in array case when p_member='ancestry.json' then array['ancestry']
  when p_member='prs.json' then array['reports.polygenic'] else array['reports.monogenic','reports.polygenic'] end loop
  if not exists(select 1 from public.purpose_grants g join public.directional_grants d using(grant_id)
   where g.target_kind='subject' and g.target_id=p_subject and g.purpose=purpose and d.recipient_account_id=a
    and d.status='current' and g.revoked_at is null and(g.expires_at is null or g.expires_at>clock_timestamp())) then continue;end if;
  direction:=case when purpose='ancestry' then private.family_ancestry_recipient_v1(a,sess,p_subject,purpose)
   else private.family_report_recipient_v1(a,sess,p_subject,purpose) end;
  if direction is null or direction->>'legacyOnly' is distinct from 'false' then
   raise exception using errcode='42501',message='not_found';end if;
  for r in select run.* from private.own_analysis_runs run where run.subject_id=p_subject
   and run.account_id=(direction#>>'{endpoints,owner,accountId}')::uuid and run.purpose=purpose
   and run.state='complete' order by run.id for share loop
   select * into f from public.genome_files where id=r.file_id and subject_id=p_subject for share;
   authority:=case when purpose='ancestry' then private.family_source_ancestry_authority_v1(f.user_id,f.id)
    else private.family_source_report_authority_v1(f.user_id,f.id,purpose) end;
   if f.id is null or private.own_analysis_completion_matches_v1(f.id,purpose,authority) is not true then
    raise exception using errcode='42501',message='not_found';end if;
   if p_member in('reports.json','reports.txt') then
    if jsonb_typeof(r.result->'reports') is distinct from 'array' then raise exception using errcode='55000',message='export_source_unavailable';end if;
    for item in select x.value,x.ordinality from jsonb_array_elements(r.result->'reports') with ordinality x loop
     identity:=r.id::text||':'||item.ordinality::text;
     row_text:=jsonb_build_object('fileId',f.id,'purpose',purpose,'completed_at',r.completed_at,'report',item.value)::text;
     return next;
    end loop;
   elsif p_member='prs.json' then
    for item in select prs.id,prs.pgs_id,prs.matched,prs.computed_at,model.name,model.trait,model.ancestry_note,model.n_variants
     from public.user_prs prs left join public.prs_scores model using(pgs_id)
     where prs.file_id=f.id and prs.subject_id=p_subject and prs.user_id=f.user_id order by prs.id for share of prs loop
     identity:=item.id::text;row_text:=(to_jsonb(item)-'id')::text;return next;
    end loop;
   else
    perform private.validate_own_ancestry_content_v1(r.result->'ancestry',f.id,p_subject,authority,r.ancestry_source->>'callEncoding');
    identity:=r.id::text;row_text:=jsonb_build_object('fileId',f.id,'completed_at',r.completed_at,'ancestry',r.result->'ancestry')::text;return next;
   end if;
   if (case when purpose='ancestry' then private.family_source_ancestry_authority_v1(f.user_id,f.id)
    else private.family_source_report_authority_v1(f.user_id,f.id,purpose) end) is distinct from authority
    or private.own_analysis_completion_matches_v1(f.id,purpose,authority) is not true then
    raise exception using errcode='42501',message='not_found';end if;
  end loop;
  if (case when purpose='ancestry' then private.family_ancestry_recipient_v1(a,sess,p_subject,purpose)
   else private.family_report_recipient_v1(a,sess,p_subject,purpose) end) is distinct from direction then
   raise exception using errcode='42501',message='not_found';end if;
 end loop;
end $$;

create function private.account_archive_complete_member_rows_v1(p_origin jsonb,p_legacy jsonb,p_permissions jsonb,
 p_subject uuid,p_member text) returns table(identity text,subject_id uuid,row_text text)
language plpgsql security definer set search_path='' set lock_timeout='250ms' set extra_float_digits=3 as $$
declare permission jsonb;a uuid;r record;page jsonb;messages jsonb;after_turn bigint;expected bigint;seen bigint;
begin
 if p_member is null or not(p_member=any(private.account_archive_complete_member_names_v1())) then
  raise exception using errcode='22023',message='invalid_request';end if;
 select x into permission from jsonb_array_elements(p_permissions)x
  where x->>'subjectId'=p_subject::text and x->>'class'='consent-covered';
 if permission is null then raise exception using errcode='42501',message='not_found';end if;
 if permission->>'status' is distinct from 'permitted' then return;end if;
 a:=(p_origin->>'accountId')::uuid;
 perform private.account_archive_export_recipient_v1(p_origin,p_subject);
 if p_member='subject.json' then
  return query select s.id::text,s.id,jsonb_build_object('id',s.id,'subject_class',s.subject_class,'upload_class',s.upload_class,
   'display_label',s.display_label,'lifecycle',s.lifecycle,'subject_binding_revision',s.subject_binding_revision,
   'lifecycle_revision',s.lifecycle_revision,'created_at',s.created_at,'updated_at',s.updated_at)::text
   from public.subjects s where s.id=p_subject;
 elsif p_member='consents.json' then
  return query select g.grant_id::text,p_subject,jsonb_build_object('grant_id',g.grant_id,'purpose',g.purpose,
   'grant_revision',g.grant_revision,'subject_binding_revision',g.subject_binding_revision,
   'artifact_key',g.artifact_key,'artifact_version',g.artifact_version,'artifact_body_sha256',g.artifact_body_sha256,
   'recipient_account_id',d.recipient_account_id,'direction',d.direction,'status',d.status,
   'revoked_at',g.revoked_at,'expires_at',g.expires_at,'signed_at',sig.signed_at,'statement_keys',sig.statement_keys)::text
   from public.purpose_grants g join public.directional_grants d using(grant_id)
   join public.consent_signatures sig on sig.id=g.signature_id
   where g.target_kind='subject' and g.target_id=p_subject and d.recipient_account_id=a order by g.grant_id;
 elsif p_member='attestations.json' then
  return query select t.id::text,p_subject,jsonb_build_object('id',t.id,'signature_id',t.signature_id,'kind',t.kind,
   'statement_keys',t.statement_keys,'affirmed',t.affirmed,'attestation_revision',t.attestation_revision,'affirmed_at',t.affirmed_at)::text
   from public.attestations t join public.consent_signatures sig on sig.id=t.signature_id
   where t.target_kind='subject' and t.target_id=p_subject and exists(select 1 from public.purpose_grants g
    join public.directional_grants d using(grant_id) where g.signature_id=sig.id and d.recipient_account_id=a) order by t.id;
 elsif p_member in('reports.json','reports.txt','prs.json','ancestry.json') then
  return query select r.identity,p_subject,r.row_text
   from private.account_archive_related_science_rows_v1(p_origin,p_subject,p_member)r;
 elsif p_member='portrait.json' then
  return query select r.identity,r.subject_id,r.row_text
   from private.account_archive_complete_class_rows_v1(p_origin,p_legacy,p_permissions,'portrait_results')r where r.subject_id=p_subject;
 elsif p_member='chats.json' then
  -- Only the requester's own conversation, never the other subject's chats.
  -- The existing full contributor projection is independently revalidated.
  for r in select ch.* from public.chats ch where ch.user_id=a and ch.subject_id=p_subject order by ch.id for share loop
   expected:=(private.export_archive_chat_messages_v1(a,(p_origin->>'sessionId')::uuid,r.id,null,null)->>'count')::bigint;
   if expected=0 then continue;end if;
   after_turn:=0;seen:=0;messages:='[]';
   loop
    page:=private.export_archive_chat_messages_v1(a,(p_origin->>'sessionId')::uuid,r.id,after_turn,200);
    messages:=messages||(page->'messages');seen:=seen+jsonb_array_length(page->'messages');
    if page->'nextAfterOrdinal'='null'::jsonb then exit;end if;
    if (page->>'nextAfterOrdinal')::bigint<=after_turn then raise exception using errcode='55000',message='export_source_unavailable';end if;
    after_turn:=(page->>'nextAfterOrdinal')::bigint;
   end loop;
   if seen<>expected or (private.export_archive_chat_messages_v1(a,(p_origin->>'sessionId')::uuid,r.id,null,null)->>'count')::bigint<>expected then
    raise exception using errcode='42501',message='not_found';end if;
   identity:=r.id::text;subject_id:=p_subject;row_text:=jsonb_build_object('id',r.id,'scope_kind',r.scope_kind,
    'created_at',r.created_at,'messages',messages)::text;
   return next;
  end loop;
 end if;
 -- The actor cannot export another account's unscoped legacy consents or audit
 -- log. Parent embryo analysis is not a new report/export permission. Their
 -- explicit excluded member receipts retain the complete applicable census.
end $$;
revoke all on function private.account_archive_complete_member_names_v1(),
 private.account_archive_related_science_rows_v1(jsonb,uuid,text),
 private.account_archive_complete_member_rows_v1(jsonb,jsonb,jsonb,uuid,text)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.account_archive_complete_member_sources_v1(p_account uuid,p_subject uuid,p_member text)
returns table(identity text,source_row jsonb)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
begin
 if p_member is null or not(p_member=any(private.account_archive_complete_member_names_v1())) then
  raise exception using errcode='22023',message='invalid_request';end if;
 if p_member='subject.json' then return query select s.id::text,to_jsonb(s) from public.subjects s where s.id=p_subject;
 elsif p_member='consents.json' then
  return query select g.grant_id::text,jsonb_build_object('grant',to_jsonb(g),'direction',to_jsonb(d),'signature',to_jsonb(sig))
   from public.purpose_grants g join public.directional_grants d using(grant_id)
   join public.consent_signatures sig on sig.id=g.signature_id
   where g.target_kind='subject' and g.target_id=p_subject and d.recipient_account_id=p_account;
 elsif p_member='attestations.json' then
  return query select t.id::text,to_jsonb(t) from public.attestations t join public.consent_signatures sig on sig.id=t.signature_id
   where t.target_kind='subject' and t.target_id=p_subject and exists(select 1 from public.purpose_grants g
    join public.directional_grants d using(grant_id) where g.signature_id=sig.id and d.recipient_account_id=p_account);
 elsif p_member in('reports.json','reports.txt') then
  return query select r.id::text||':'||entry.ordinality::text,jsonb_build_object('run',to_jsonb(r),'ordinal',entry.ordinality,'report',entry.value)
   from private.own_analysis_runs r cross join lateral jsonb_array_elements(r.result->'reports') with ordinality entry
   where r.subject_id=p_subject and r.state='complete' and r.purpose in('reports.monogenic','reports.polygenic');
 elsif p_member='prs.json' then return query select p.id::text,to_jsonb(p)
  from public.user_prs p where p.subject_id=p_subject;
 elsif p_member='ancestry.json' then
  return query select r.id::text,to_jsonb(r) from private.own_analysis_runs r
   where r.subject_id=p_subject and r.state='complete' and r.purpose='ancestry'
  union all select 'legacy:'||r.id::text,to_jsonb(r) from public.ancestry_results r where r.subject_id=p_subject;
 elsif p_member='chats.json' then
  return query select ch.id::text,jsonb_build_object('chat',to_jsonb(ch),'messages',coalesce((select jsonb_agg(to_jsonb(m)
   order by m.turn_ordinal,m.role,m.id) from public.chat_messages m where m.chat_id=ch.id),'[]'))
   from public.chats ch where ch.user_id=p_account and ch.subject_id=p_subject;
 elsif p_member='portrait.json' then
  return query select r.identity,r.source_row from private.account_archive_complete_source_rows_v1(p_account,array[p_subject],'portrait_results')r
   where r.subject_id=p_subject;
 elsif p_member='embryos.json' then return query select e.id::text,to_jsonb(e) from public.embryos e where e.subject_id=p_subject;
 end if;
 -- Legacy account consents and an account's unscoped audit log have no foreign
 -- subject-member slice. Their genuine requester history is already legacy.
end $$;

create function private.account_archive_complete_member_census_v1(p_origin jsonb,p_legacy jsonb,p_permissions jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare permission jsonb;sid uuid;name text;r record;n bigint;source_n bigint;digest bytea;source_digest bytea;
 out jsonb:='[]';sources jsonb:='[]';status text;reason text;
begin
 for permission in select x from jsonb_array_elements(p_permissions)x where x->>'class'='consent-covered'
  order by x->>'subjectId' loop
  sid:=(permission->>'subjectId')::uuid;
  foreach name in array private.account_archive_complete_member_names_v1() loop
   digest:=extensions.digest(convert_to('account-complete-member-v1|'||sid::text||'|'||name,'UTF8'),'sha256');
   source_digest:=extensions.digest(convert_to('account-complete-member-source-v1|'||sid::text||'|'||name,'UTF8'),'sha256');
   n:=0;source_n:=0;
   for r in select * from private.account_archive_complete_member_sources_v1((p_origin->>'accountId')::uuid,sid,name)row
    order by jsonb_build_array(sid,row.identity)::text collate "C" loop
    source_n:=source_n+1;source_digest:=extensions.digest(source_digest||convert_to(r.identity||':'||sid::text||':'||r.source_row::text||E'\n','UTF8'),'sha256');
   end loop;
   for r in select * from private.account_archive_complete_member_rows_v1(p_origin,p_legacy,p_permissions,sid,name)row
    order by jsonb_build_array(row.subject_id,row.identity)::text collate "C" loop
    if r.subject_id is distinct from sid then raise exception using errcode='55000',message='export_source_unavailable';end if;
    n:=n+1;digest:=extensions.digest(digest||convert_to(r.identity||':'||sid::text||':'||r.row_text||E'\n','UTF8'),'sha256');
   end loop;
   if n>source_n or source_n>9007199254740991 then raise exception using errcode='55000',message='export_source_unavailable';end if;
   status:=case when n>0 or(source_n=0 and permission->>'status'='permitted' and name not in('legacy-consents.json','audit-log.json','embryos.json'))
    then 'permitted' else 'excluded' end;
   reason:=case when status='permitted' then 'signed-report-export' when name='embryos.json' then 'export-recipient-consent-required'
    when permission->>'status'='excluded' then 'export-recipient-consent-required' else 'outside-consent-scope' end;
   out:=out||jsonb_build_array(jsonb_build_object('subjectId',sid,'member',name,'sourceRows',source_n,'rows',n,
    'membershipSha256',encode(digest,'hex'),'status',status,'reason',reason,
    'authoritySha256',encode(extensions.digest(convert_to(permission::text,'UTF8'),'sha256'),'hex')));
   sources:=sources||jsonb_build_array(jsonb_build_object('subjectId',sid,'member',name,'rows',source_n,
    'membershipSha256',encode(source_digest,'hex')));
  end loop;
 end loop;
 return jsonb_build_object('members',out,'sources',sources);
end $$;
revoke all on function private.account_archive_complete_member_sources_v1(uuid,uuid,text),
 private.account_archive_complete_member_census_v1(jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.account_archive_complete_history_rows_v1(p_origin jsonb,p_legacy jsonb,p_permissions jsonb,p_kind text)
returns table(identity text,subject_id uuid,row_text text)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare a uuid;subjects uuid[];
begin
 if p_kind is null or p_kind not in('legacy-consents','subjects','demographics','principals','bindings',
  'account-consents','signatures','attestations','recipient-grants') then raise exception using errcode='22023',message='invalid_request';end if;
 a:=(p_origin->>'accountId')::uuid;
 select coalesce(array_agg((x->>'subjectId')::uuid order by x->>'subjectId'),'{}'::uuid[]) into subjects
  from jsonb_array_elements(p_permissions)x where x->>'class'='consent-covered' and x->>'status'='permitted';
 if p_kind='subjects' then
  return query select r.projected_id::text,(r.projected_row->>'id')::uuid,r.projected_row::text
   from private.export_account_history_projection_v1(a,subjects,'subjects')r;
 elsif p_kind='signatures' then
  return query select sig.id::text,sig.target_id,jsonb_build_object('id',sig.id,'artifact_key',sig.artifact_key,
   'artifact_version',sig.artifact_version,'artifact_body_sha256',sig.artifact_body_sha256,'signer_principal_id',sig.signer_principal_id,
   'target_kind',sig.target_kind,'target_id',sig.target_id,'purpose',sig.purpose,'statement_keys',sig.statement_keys,
   'jurisdiction_code',sig.jurisdiction_code,'jurisdiction_revision',sig.jurisdiction_revision,
   'subject_binding_revision',sig.subject_binding_revision,'signed_at',sig.signed_at)::text
   from public.consent_signatures sig where sig.target_kind='subject' and sig.target_id=any(subjects)
    and sig.signer_account_id is distinct from a and exists(select 1 from public.purpose_grants g
     join public.directional_grants d using(grant_id) where g.signature_id=sig.id and d.recipient_account_id=a);
 elsif p_kind='attestations' then
  return query select t.id::text,t.target_id,jsonb_build_object('id',t.id,'signature_id',t.signature_id,
   'principal_id',t.principal_id,'target_kind',t.target_kind,'target_id',t.target_id,'kind',t.kind,'statement_keys',t.statement_keys,
   'affirmed',t.affirmed,'attestation_revision',t.attestation_revision,'affirmed_at',t.affirmed_at)::text
   from public.attestations t join public.consent_signatures sig on sig.id=t.signature_id
   where t.target_kind='subject' and t.target_id=any(subjects) and sig.signer_account_id is distinct from a
    and not exists(select 1 from public.subject_principals sp where sp.id=t.principal_id and sp.account_id=a)
    and exists(select 1 from public.purpose_grants g join public.directional_grants d using(grant_id)
     where g.signature_id=sig.id and d.recipient_account_id=a);
 end if;
 -- Other people's account-wide consents, bindings, provider grants, private
 -- demographics and principals are not borrowed from an uploader identity.
end $$;

create function private.account_archive_complete_history_census_v1(p_origin jsonb,p_legacy jsonb,p_permissions jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare kind text;r record;digest bytea;n bigint;out jsonb:='[]';old jsonb;parts jsonb;
begin
 foreach kind in array array['legacy-consents','subjects','demographics','principals','bindings',
  'account-consents','signatures','attestations','recipient-grants'] loop
  select x into old from jsonb_array_elements(p_legacy->'memberInventory')x where x->>'kind'=kind;
  if old is null then raise exception using errcode='55000',message='export_source_unavailable';end if;
  digest:=extensions.digest(convert_to('account-complete-history-routed-v1|'||kind,'UTF8'),'sha256');n:=0;
  for r in select * from private.account_archive_complete_history_rows_v1(p_origin,p_legacy,p_permissions,kind)row
   order by jsonb_build_array(row.subject_id,row.identity)::text collate "C" loop
   if r.subject_id is null or r.row_text is null then raise exception using errcode='55000',message='export_source_unavailable';end if;
   n:=n+1;digest:=extensions.digest(digest||convert_to(r.identity||':'||r.subject_id::text||':'||r.row_text||E'\n','UTF8'),'sha256');
  end loop;
  if n>9007199254740991 then raise exception using errcode='55000',message='export_source_unavailable';end if;
  select coalesce(jsonb_agg(jsonb_build_object('subjectId',sid,'rows',num) order by sid),'[]') into parts from(
   select row.subject_id sid,count(*) num from private.account_archive_complete_history_rows_v1(p_origin,p_legacy,p_permissions,kind)row
   group by row.subject_id)counts;
  out:=out||jsonb_build_array(jsonb_build_object('kind',kind,'legacy',jsonb_build_object('rows',old->'rows','membershipSha256',old->'membershipSha256'),
   'routed',jsonb_build_object('rows',n,'membershipSha256',encode(digest,'hex'),'partitions',parts),
   'rows',(old->>'rows')::bigint+n,'membershipSha256',encode(extensions.digest(convert_to('account-complete-history-v1|'||kind||E'\n'||
    (old->>'rows')||':'||(old->>'membershipSha256')||E'\n'||n::text||':'||encode(digest,'hex')||E'\n','UTF8'),'sha256'),'hex')));
 end loop;
 return out;
end $$;
revoke all on function private.account_archive_complete_history_rows_v1(jsonb,jsonb,jsonb,text),
 private.account_archive_complete_history_census_v1(jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- A JS feature flag cannot select this frame. The existing owner-only native
-- configuration must be enabled and the real actor must be in TEST. Disabling
-- it invalidates old complete receipts rather than adopting a legacy capture.
create function private.account_archive_complete_enabled_v1(p_origin jsonb) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare config private.account_archive_r2_configuration;profile public.profiles;
begin
 if jsonb_typeof(p_origin) is distinct from 'object' or p_origin->>'kind' is distinct from 'account'
  or(select count(*) from jsonb_object_keys(p_origin))<>3 or not(p_origin ?& array['kind','accountId','sessionId']) then
  return false;end if;
 select * into config from private.account_archive_r2_configuration where singleton for share;
 if config.enabled is distinct from true or config.bucket is null or config.binding_sha256 is null then return false;end if;
 select * into profile from public.profiles where id=(p_origin->>'accountId')::uuid for share;
 return profile.id is not null and profile.jurisdiction_code='TEST' and profile.jurisdiction_declared_at is not null
  and profile.deletion_requested_at is null;
end $$;
revoke all on function private.account_archive_complete_enabled_v1(jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.account_archive_complete_capture_v1(p_origin jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare a uuid;legacy jsonb;ids uuid[];sid uuid;permission jsonb;permissions jsonb:='[]';classes jsonb;members jsonb;history jsonb;
 files jsonb:='[]';file record;frame jsonb;receipt text;parts jsonb;file_ids jsonb;n bigint;
begin
 if private.account_archive_complete_enabled_v1(p_origin) is not true then
  raise exception using errcode='42501',message='not_found';end if;
 a:=(p_origin->>'accountId')::uuid;
 legacy:=private.account_archive_legacy_capture_v1(p_origin);
 ids:=private.account_archive_complete_subjects_v1(p_origin);
 for sid in select unnest(ids) loop
  permissions:=permissions||jsonb_build_array(private.account_archive_complete_subject_authority_v1(p_origin,sid,legacy));
 end loop;
 classes:=private.account_archive_complete_class_census_v1(p_origin,legacy,permissions);
 members:=private.account_archive_complete_member_census_v1(p_origin,legacy,permissions);
 history:=private.account_archive_complete_history_census_v1(p_origin,legacy,permissions);
 parts:='[]';n:=0;
 for permission in select x from jsonb_array_elements(permissions)x order by x->>'subjectId' loop
  sid:=(permission->>'subjectId')::uuid;file_ids:='[]';
  if permission->>'class' in('ordinary','claimed-bound') then
   select coalesce(jsonb_agg(gf.id order by gf.id),'[]') into file_ids from public.genome_files gf where gf.subject_id=sid
    and(permission->>'class'='claimed-bound' or not private.export_account_path_b_file_v1(gf.id));
  elsif permission->'rawAuthority'<>'null'::jsonb then
   -- A permitted raw partition enumerates every source. A partial/unavailable
   -- original or normalization makes the whole request refuse.
   for file in select gf.id from public.genome_files gf where gf.subject_id=sid order by gf.id for share loop
    files:=files||jsonb_build_array(private.account_archive_raw_file_inventory_v1(p_origin,file.id));
    file_ids:=file_ids||jsonb_build_array(file.id);
   end loop;
  end if;
  n:=n+jsonb_array_length(file_ids);
  parts:=parts||jsonb_build_array(jsonb_build_object('subjectId',sid,'class',permission->'class',
   'fileCount',jsonb_array_length(file_ids),'fileIds',file_ids));
 end loop;
 frame:=jsonb_build_object('version','account-complete-native-capture-v1','origin',p_origin,'legacy',legacy,
  'nativeConfiguration',(select to_jsonb(c) from private.account_archive_r2_configuration c where c.singleton),
  'permissions',permissions,'classCensus',classes,'memberCensus',members,'history',history,'files',files,'scopePartitions',parts,
  'allSubjects',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.subjects s where s.id=any(ids)),
  'allDemographics',(select coalesce(jsonb_agg(to_jsonb(d) order by d.subject_id),'[]') from public.subject_demographics d where d.subject_id=any(ids)),
  'allSourceClocks',(select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]') from public.genome_files f where f.subject_id=any(ids)),
  'allNormalizations',(select coalesce(jsonb_agg(to_jsonb(r) order by r.file_id),'[]') from private.own_normalization_runs r
   where r.file_id in(select id from public.genome_files where subject_id=any(ids))),
  'allAnalysis',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from private.own_analysis_runs r where r.subject_id=any(ids)),
  'allCanonicalSources',(select coalesce(jsonb_agg(to_jsonb(r) order by r.file_id),'[]') from private.embryo_canonical_sources r where r.subject_id=any(ids)));
 receipt:=encode(extensions.digest(convert_to(frame::text,'UTF8'),'sha256'),'hex');
 return frame||jsonb_build_object('captureSha256',receipt,'authority',legacy->'authority'||jsonb_build_object(
  'authorityReceipt',receipt,'subjectPartitions',to_jsonb(ids),'fileCount',n));
end $$;
revoke all on function private.account_archive_complete_capture_v1(jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- This is only discovery. The dispatcher must still consume the unchanged
-- export_archive_cleanup_v1('stop') transition before discovering allocations.
-- Filtering before LIMIT avoids another download family hiding due accounts.
create function private.account_archive_test_cleanup_due_v1() returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='250ms' as $$
declare result jsonb;
begin
 perform private.account_archive_test_configuration_v1();
 select coalesce(jsonb_agg(to_jsonb(page) order by "attemptId"),'[]'::jsonb) into result from(
  select a.export_id as "exportId",a.id as "attemptId"
   from private.export_archive_attempts a join private.export_archive_jobs j on j.export_id=a.export_id
   join public.generated_exports e on e.id=a.export_id
  where e.origin_kind='account' and e.target_kind='account' and e.export_kind='account_portable'
   and e.purpose='raw.export' and e.archive_version='archive-segments-v1'
   and j.route_id='api.export' and j.export_contract='account-export-v1'
   and jsonb_typeof(j.origin)='object' and (select count(*) from jsonb_object_keys(j.origin))=3
   and j.origin ?& array['kind','accountId','sessionId'] and j.origin->>'kind'='account'
   and j.origin->>'accountId'=e.account_id::text and e.target_id=e.account_id
   and coalesce(j.origin->>'sessionId','')~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and ((a.state='writing' and a.lease_expires_at<=clock_timestamp())
    or (a.state='bytes_complete' and j.deadline<=clock_timestamp())
    or (a.state='cleanup_pending' and a.cleanup_not_before<=clock_timestamp()))
  order by a.id limit 16
 )page;
 return result;
end $$;
revoke all on function private.account_archive_test_cleanup_due_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Public compatibility DTOs are constructed from the actual captured legacy
-- subset. Internal signature/source state is never exposed as a subframe.
create function private.account_archive_complete_context_v1(p_capture jsonb,p_permit jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare legacy jsonb;context jsonb;parts jsonb;legacy_parts jsonb;legacy_files bigint;bound jsonb;
begin
 legacy:=p_capture->'legacy';parts:=p_capture->'scopePartitions';
 select coalesce(jsonb_agg(x order by x->>'subjectId'),'[]'),coalesce(sum((x->>'fileCount')::bigint),0)
  into legacy_parts,legacy_files from jsonb_array_elements(parts)x where x->>'class'<>'consent-covered';
 context:=jsonb_build_object('version','account-archive-members-v1','targetKind','account','targetId',p_permit->'targetId',
  'authorityReceipt',p_permit->'authorityReceipt','deadline',p_permit->'deadline','capturedAt',p_permit->'capturedAt',
  'actor',jsonb_build_object('accountId',p_permit#>'{origin,accountId}','sessionId',p_permit#>'{origin,sessionId}'),
  'fileCount',legacy_files,'partitions',legacy_parts);
 select coalesce(jsonb_agg(jsonb_set(x->'capture','{authority,authorityReceipt}',p_permit->'authorityReceipt')
  order by x->>'subjectId'),'[]') into bound from jsonb_array_elements(legacy->'partitions')x where x->>'class'='claimed-bound';
 return jsonb_build_object('version','account-complete-members-v1','targetKind','account','targetId',p_permit->'targetId',
  'authorityReceipt',p_permit->'authorityReceipt','deadline',p_permit->'deadline','capturedAt',p_permit->'capturedAt',
  'actor',context->'actor','fileCount',p_capture#>'{authority,fileCount}','partitions',parts,
  'legacyCapture',jsonb_build_object('context',context,
   'classes',jsonb_build_object('version','account-class-inventory-v1','authorityReceipt',p_permit->'authorityReceipt',
    'classes',legacy->'classInventory','ownStatements',legacy->'ownStatements','boundSnapshots',bound),
   'inventory',jsonb_build_object('version','account-history-inventory-v1','authorityReceipt',p_permit->'authorityReceipt',
    'classes',legacy->'memberInventory')),
  'completeReceipt',jsonb_build_object('version','account-complete-capture-receipt-v1','captureSha256',p_capture->'captureSha256',
   'subjectCount',jsonb_array_length(parts),'fileCount',p_capture#>'{authority,fileCount}',
   'classes',p_capture#>'{classCensus,classes}','members',p_capture#>'{memberCensus,members}',
   'history',p_capture->'history','files',p_capture->'files'),
  'dispositions',p_capture#>'{classCensus,dispositions}');
end $$;

create function private.account_archive_complete_selected_rows_v1(p_origin jsonb,p_capture jsonb,
 p_family text,p_kind text,p_subject uuid,p_file uuid)
returns table(identity text,subject_id uuid,row_text text)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
begin
 if p_family='class' and p_subject is null and p_file is null then
  return query select * from private.account_archive_complete_class_rows_v1(p_origin,p_capture->'legacy',p_capture->'permissions',p_kind);
 elsif p_family='member' and p_subject is not null and p_file is null then
  if not exists(select 1 from jsonb_array_elements(p_capture->'permissions')x
   where x->>'subjectId'=p_subject::text and x->>'class'='consent-covered') then
   raise exception using errcode='42501',message='not_found';end if;
  return query select * from private.account_archive_complete_member_rows_v1(p_origin,p_capture->'legacy',p_capture->'permissions',p_subject,p_kind);
 elsif p_family='history' and p_subject is null and p_file is null then
  return query select * from private.account_archive_complete_history_rows_v1(p_origin,p_capture->'legacy',p_capture->'permissions',p_kind);
 elsif p_family='file' and p_file is not null and p_subject is null then
  if not exists(select 1 from jsonb_array_elements(p_capture->'files')x where x->>'fileId'=p_file::text) then
   raise exception using errcode='42501',message='not_found';end if;
  return query select * from private.account_archive_raw_file_rows_v1(p_origin,p_file,p_kind);
 else raise exception using errcode='22023',message='invalid_request';end if;
end $$;

create function private.account_archive_complete_key_v1(p_key jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p_key) is distinct from 'array' or jsonb_array_length(p_key)<>2
  or jsonb_typeof(p_key->0) is distinct from 'string' or jsonb_typeof(p_key->1) is distinct from 'string'
  or (p_key->>0)!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or (p_key->>1)!~'^[ -~]{1,2048}$' then raise exception using errcode='22023',message='invalid_request';end if;
 return p_key;
end $$;

create function private.account_archive_complete_page_v1(p_origin jsonb,p_capture jsonb,p_family text,p_kind text,
 p_subject uuid,p_file uuid,p_after jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare r record;key jsonb;last_key jsonb;rows jsonb:='[]';value jsonb;candidate jsonb;more boolean:=false;n integer:=0;
begin
 if exists(select 1 from private.account_archive_complete_selected_rows_v1(p_origin,p_capture,p_family,p_kind,p_subject,p_file)r
  group by coalesce(p_file,r.subject_id),r.identity having count(*)<>1) then
  raise exception using errcode='55000',message='export_source_unavailable';end if;
 if p_after is not null then
  perform private.account_archive_complete_key_v1(p_after);
  if not exists(select 1 from private.account_archive_complete_selected_rows_v1(p_origin,p_capture,p_family,p_kind,p_subject,p_file)r
   where jsonb_build_array(coalesce(p_file,r.subject_id),r.identity)=p_after) then
   raise exception using errcode='22023',message='invalid_request';end if;
 end if;
 for r in select * from private.account_archive_complete_selected_rows_v1(p_origin,p_capture,p_family,p_kind,p_subject,p_file)row
  where p_after is null or jsonb_build_array(coalesce(p_file,row.subject_id),row.identity)::text collate "C">p_after::text collate "C"
  order by jsonb_build_array(coalesce(p_file,row.subject_id),row.identity)::text collate "C" limit 501 loop
  key:=jsonb_build_array(coalesce(p_file,r.subject_id),r.identity);perform private.account_archive_complete_key_v1(key);
  if r.subject_id is null or r.row_text is null or octet_length(r.row_text)=0 then
   raise exception using errcode='55000',message='export_source_unavailable';end if;
  if n=500 then more:=true;exit;end if;
  value:=jsonb_build_object('identity',r.identity,'key',key,'subjectId',r.subject_id,'scope','subject',
   'rowText',case when octet_length(r.row_text)<=1000000 and octet_length(to_jsonb(r.row_text)::text)<=3000000 then to_jsonb(r.row_text) else 'null'::jsonb end,
   'rowSource',case when octet_length(r.row_text)<=1000000 and octet_length(to_jsonb(r.row_text)::text)<=3000000 then 'null'::jsonb else
    jsonb_build_object('byteCount',octet_length(r.row_text),'sha256',encode(extensions.digest(convert_to(r.row_text,'UTF8'),'sha256'),'hex')) end);
  candidate:=jsonb_build_object('version','account-complete-page-v1','kind',p_kind,'rows',rows||jsonb_build_array(value),'nextAfterKey',key);
  if octet_length(candidate::text)>4000000 then
   if n=0 then raise exception using errcode='55000',message='export_source_unavailable';end if;
   more:=true;exit;end if;
  rows:=rows||jsonb_build_array(value);n:=n+1;last_key:=key;
 end loop;
 return jsonb_build_object('version','account-complete-page-v1','kind',p_kind,'rows',rows,'nextAfterKey',case when more then last_key else null end);
end $$;

create function private.account_archive_complete_bytes_v1(p_origin jsonb,p_capture jsonb,p_family text,p_kind text,
 p_subject uuid,p_file uuid,p_key jsonb,p_offset bigint) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare text_row text;content bytea;n bigint;chunk bytea;row_count bigint;
begin
 perform private.account_archive_complete_key_v1(p_key);
 if p_offset is null or p_offset<0 or p_offset>9007199254740991 then raise exception using errcode='22023',message='invalid_request';end if;
 select count(*),min(r.row_text) into row_count,text_row from private.account_archive_complete_selected_rows_v1(p_origin,p_capture,p_family,p_kind,p_subject,p_file)r
  where jsonb_build_array(coalesce(p_file,r.subject_id),r.identity)=p_key;
 if row_count<>1 or text_row is null or octet_length(text_row)=0 then
  raise exception using errcode='22023',message='invalid_request';end if;
 content:=convert_to(text_row,'UTF8');n:=octet_length(content);
 if p_offset>=n then raise exception using errcode='22023',message='invalid_request';end if;
 chunk:=substring(content from p_offset::integer+1 for least(786432,n-p_offset)::integer);
 return jsonb_build_object('version','account-complete-row-bytes-v1','kind',p_kind,'key',p_key,'byteOffset',p_offset,
  'totalBytes',n,'sha256',encode(extensions.digest(content,'sha256'),'hex'),
  'base64',replace(encode(chunk,'base64'),E'\n',''),'eof',p_offset+octet_length(chunk)=n);
end $$;
revoke all on function private.account_archive_complete_context_v1(jsonb,jsonb),
 private.account_archive_complete_selected_rows_v1(jsonb,jsonb,text,text,uuid,uuid),private.account_archive_complete_key_v1(jsonb),
 private.account_archive_complete_page_v1(jsonb,jsonb,text,text,uuid,uuid,jsonb),
 private.account_archive_complete_bytes_v1(jsonb,jsonb,text,text,uuid,uuid,jsonb,bigint)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Physical source identity is resolved under the distinct current raw tuple.
-- This never calls an own-session source reader for someone else's file.
create function private.account_archive_complete_original_v1(p_permit jsonb,p_capture jsonb,p_file uuid,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare saved jsonb;current_source jsonb;frame jsonb;physical jsonb;state jsonb;source jsonb;result jsonb;
 expiry timestamptz;expected_expiry timestamptz;retirement private.own_original_retirements;prepared boolean;
begin
 select x into saved from jsonb_array_elements(p_capture->'files')x where x->>'fileId'=p_file::text;
 if saved is null then raise exception using errcode='42501',message='not_found';end if;
 if p_expected is not null and (jsonb_typeof(p_expected) is distinct from 'object' or octet_length(p_expected::text)>8192
  or (select count(*) from jsonb_object_keys(p_expected))<>11
  or not(p_expected ?& array['version','exportId','attemptId','authorityReceipt','fileId','subjectId','rawAuthoritySha256',
   'decodedSha256','state','source','actor'])) then raise exception using errcode='22023',message='invalid_request';end if;
 current_source:=private.account_archive_raw_source_v1(p_permit->'origin',p_file);
 if private.account_archive_raw_file_inventory_v1(p_permit->'origin',p_file) is distinct from saved then
  raise exception using errcode='42501',message='not_found';end if;
 frame:=current_source->'originalFrame';physical:=frame->'physical';state:=frame->'state';
 prepared:=saved#>>'{content,backend}'='prepared-object-v1';
 if (state->>'retired')::boolean is true then source:=null;
 else
  expiry:=least(clock_timestamp()+interval '270 seconds',(p_permit->>'leaseExpiresAt')::timestamptz,
   (p_permit->>'deadline')::timestamptz-interval '30 seconds');
  if prepared then
   if private.own_prepared_original_identity_v1(p_file,(saved#>>'{content,source,manifestId}')::uuid,true) is not true then
    raise exception using errcode='42501',message='not_found';end if;
   select * into retirement from private.own_original_retirements where file_id=p_file for share;
   if retirement.file_id is not null and(retirement.state='retired' or retirement.delete_started_at is not null
    or retirement.expires_at<=clock_timestamp()) then raise exception using errcode='42501',message='not_found';end if;
   expiry:=least(expiry,retirement.expires_at);
  end if;
  if p_expected is not null then
   begin expected_expiry:=(p_expected#>>'{source,expiresAt}')::timestamptz;
   exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_request';end;
   if expected_expiry is null or expected_expiry>expiry then raise exception using errcode='42501',message='not_found';end if;
   expiry:=expected_expiry;
  end if;
  if ((physical->>'storageVersion')~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') is not true
   or expiry<=clock_timestamp() then raise exception using errcode='42501',message='not_found';end if;
  source:=jsonb_build_object('version',case when prepared then 'prepared-original-download-v1' else 'account-original-download-v1' end,
   'fileId',p_file,'sourceRevision',physical->'sourceRevision','rawSha256',physical->'rawSha256',
   'bucket',physical->'bucket','objectId',physical->'objectId','objectKey',physical->'objectKey',
   'storageVersion',physical->'storageVersion','sizeBytes',physical->'sizeBytes','expiresAt',expiry);
  if prepared then source:=source||jsonb_build_object('manifestId',saved#>'{content,source,manifestId}');end if;
 end if;
 result:=jsonb_build_object('version','account-complete-original-v1','exportId',p_permit->'exportId','attemptId',p_permit->'attemptId',
  'authorityReceipt',p_permit->'authorityReceipt','fileId',p_file,'subjectId',saved->'subjectId',
  'rawAuthoritySha256',saved->'rawAuthoritySha256','decodedSha256',saved->'decodedSha256','state',state,'source',source,
  'actor',jsonb_build_object('accountId',p_permit#>'{origin,accountId}','sessionId',p_permit#>'{origin,sessionId}'));
 if (p_expected is not null and result is distinct from p_expected)
  or private.account_archive_raw_source_v1(p_permit->'origin',p_file) is distinct from current_source then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $$;
revoke all on function private.account_archive_complete_original_v1(jsonb,jsonb,uuid,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function public.export_archive_account_complete_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_kind text default null,p_after_key jsonb default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' set extra_float_digits=3 as $$
declare permit jsonb;capture jsonb;result jsonb;family text;sid uuid;fid uuid;cursor jsonb;key jsonb;offset_value bigint;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('context','rows','row-bytes','original','member-rows','member-bytes',
  'history-rows','history-bytes','file-rows','file-bytes','prepared-member')
  or(p_after_key is not null and octet_length(p_after_key::text)>8192) then
  raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if permit->>'targetKind' is distinct from 'account' then raise exception using errcode='42501',message='not_found';end if;
 capture:=private.account_archive_complete_capture_v1(permit->'origin');
 if capture#>'{authority,authorityReceipt}' is distinct from permit->'authorityReceipt'
  or capture#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then
  raise exception using errcode='42501',message='not_found';end if;
 if p_operation='context' then
  if p_kind is not null or p_after_key is not null then raise exception using errcode='22023',message='invalid_request';end if;
  result:=private.account_archive_complete_context_v1(capture,permit);
 elsif p_operation in('original','prepared-member') then
  if p_kind is not null or jsonb_typeof(p_after_key) is distinct from 'object'
   or jsonb_typeof(p_after_key->'fileId') is distinct from 'string'
   or(p_after_key->>'fileId')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   or not exists(select 1 from jsonb_array_elements(capture->'files')x where x->>'fileId'=p_after_key->>'fileId') then
   raise exception using errcode='22023',message='invalid_request';end if;
  fid:=(p_after_key->>'fileId')::uuid;
  if p_operation='original' then
   if(select count(*) from jsonb_object_keys(p_after_key))<>2 or not(p_after_key ?& array['fileId','expected']) then
    raise exception using errcode='22023',message='invalid_request';end if;
   result:=private.account_archive_complete_original_v1(permit||jsonb_build_object('exportId',p_export_id,'attemptId',p_attempt_id),capture,fid,
    nullif(p_after_key->'expected','null'::jsonb));
  else
   if(select count(*) from jsonb_object_keys(p_after_key))<>4 or not(p_after_key ?& array['fileId','manifestId','artifactId','expected'])
    or jsonb_typeof(p_after_key->'manifestId') is distinct from 'string' or jsonb_typeof(p_after_key->'artifactId') is distinct from 'string'
    or(p_after_key->>'manifestId')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or(p_after_key->>'artifactId')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode='22023',message='invalid_request';end if;
   result:=private.account_archive_raw_prepared_member_v1(permit->'origin',fid,(p_after_key->>'manifestId')::uuid,
    (p_after_key->>'artifactId')::uuid,p_after_key->'expected');
  end if;
 else
  family:=case when p_operation in('rows','row-bytes') then 'class'
   when p_operation in('member-rows','member-bytes') then 'member'
   when p_operation in('history-rows','history-bytes') then 'history' else 'file' end;
  if p_kind is null or(family='class' and not(p_kind=any(private.account_archive_complete_class_kinds_v1())))
   or(family='member' and not(p_kind=any(private.account_archive_complete_member_names_v1())))
   or(family='history' and p_kind not in('legacy-consents','subjects','demographics','principals','bindings',
    'account-consents','signatures','attestations','recipient-grants'))
   or(family='file' and p_kind not in('variants','observed','canonical')) then
   raise exception using errcode='22023',message='invalid_request';end if;
  if family in('member','file') then
   if jsonb_typeof(p_after_key) is distinct from 'object' or jsonb_typeof(p_after_key->(case when family='member' then 'subjectId' else 'fileId' end)) is distinct from 'string'
    or(p_after_key->>(case when family='member' then 'subjectId' else 'fileId' end))!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode='22023',message='invalid_request';end if;
   if family='member' then sid:=(p_after_key->>'subjectId')::uuid;else fid:=(p_after_key->>'fileId')::uuid;end if;
  end if;
  if p_operation in('rows','member-rows','history-rows','file-rows') then
   if family in('member','file') then
    if(select count(*) from jsonb_object_keys(p_after_key))<>2
     or not(p_after_key ?& array[case when family='member' then 'subjectId' else 'fileId' end,'afterKey']) then
     raise exception using errcode='22023',message='invalid_request';end if;
    cursor:=nullif(p_after_key->'afterKey','null'::jsonb);
   else cursor:=p_after_key;end if;
   result:=private.account_archive_complete_page_v1(permit->'origin',capture,family,p_kind,sid,fid,cursor);
  else
   if jsonb_typeof(p_after_key) is distinct from 'object'
    or(select count(*) from jsonb_object_keys(p_after_key))<>(case when family in('member','file') then 3 else 2 end)
    or not(p_after_key ?& array['key','offset']) or jsonb_typeof(p_after_key->'offset') is distinct from 'number'
    or(p_after_key->>'offset')!~'^(0|[1-9][0-9]{0,15})$' or(p_after_key->>'offset')::numeric>9007199254740991 then
    raise exception using errcode='22023',message='invalid_request';end if;
   key:=p_after_key->'key';offset_value:=(p_after_key->>'offset')::bigint;
   result:=private.account_archive_complete_bytes_v1(permit->'origin',capture,family,p_kind,sid,fid,key,offset_value);
  end if;
 end if;
 if result is null or octet_length(result::text)>4000000 then raise exception using errcode='55000',message='export_source_unavailable';end if;
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.account_archive_complete_capture_v1(permit->'origin') is distinct from capture then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $$;
revoke all on function public.export_archive_account_complete_v1(text,uuid,uuid,text,text,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_complete_v1(text,uuid,uuid,text,text,jsonb) to service_role;

-- Select the complete account frame at the durable capture door, before any
-- old unsupported whole-account refusal. The subject-only implementation is
-- retained verbatim under its old-body delegate and is still selected first
-- for a subject export. Legacy public readers see only their own named subset.
alter function private.export_account_owned_capture_v1(jsonb,text,uuid)
 rename to export_account_owned_capture_pre_complete_v1;
create function private.export_account_owned_capture_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare complete jsonb;
begin
 if p_target_kind is distinct from 'account' then
  return private.export_account_owned_capture_pre_complete_v1(p_origin,p_target_kind,p_target_id);end if;
 if private.account_archive_complete_enabled_v1(p_origin) is not true then
  return private.export_account_owned_capture_pre_complete_v1(p_origin,p_target_kind,p_target_id);end if;
 if p_target_id is distinct from (p_origin->>'accountId')::uuid then raise exception using errcode='42501',message='not_found';end if;
 complete:=private.account_archive_complete_capture_v1(p_origin);
 return (complete->'legacy')||jsonb_build_object('authority',complete->'authority','completeCapture',complete);
end $$;
revoke all on function private.export_account_owned_capture_pre_complete_v1(jsonb,text,uuid),
 private.export_account_owned_capture_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Exact source-body guarded compatibility refinements. Each original own,
-- bound, Path B, source, request, attempt and before/after predicate remains.
-- Only the named legacy selection/count is substituted, never the full permit.
do $legacy_subset_0$
declare definition text;old_fragment text;new_fragment text;
begin
 if (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_metadata_v1(text,uuid,uuid,text,uuid)') and pg_catalog.pg_get_userbyid(p.proowner)='postgres') is distinct from 'b48f1e537700bf6e0ae87e29cbea574e' then
  raise exception using errcode='55000',message='account_complete_compatibility_predecessor_unavailable';end if;
 definition:=pg_catalog.pg_get_functiondef('public.export_archive_account_metadata_v1(text,uuid,uuid,text,uuid)'::regprocedure);
 old_fragment:=$before_0_0$select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(permit->'partitions')x;$before_0_0$;
 new_fragment:=$after_0_0$select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into subjects from jsonb_array_elements(capture->'partitions')x;$after_0_0$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='account_complete_compatibility_predecessor_unavailable';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
end $legacy_subset_0$;
do $legacy_subset_1$
declare definition text;old_fragment text;new_fragment text;
begin
 if (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_inventory_v1(text,uuid,uuid,text,text,uuid)') and pg_catalog.pg_get_userbyid(p.proowner)='postgres') is distinct from '754012d0f8d93529809a7acb253caf60' then
  raise exception using errcode='55000',message='account_complete_compatibility_predecessor_unavailable';end if;
 definition:=pg_catalog.pg_get_functiondef('public.export_archive_account_inventory_v1(text,uuid,uuid,text,text,uuid)'::regprocedure);
 old_fragment:=$before_1_0$select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(permit->'partitions')x;$before_1_0$;
 new_fragment:=$after_1_0$select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into subjects from jsonb_array_elements(capture->'partitions')x;$after_1_0$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='account_complete_compatibility_predecessor_unavailable';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
end $legacy_subset_1$;
do $legacy_subset_2$
declare definition text;old_fragment text;new_fragment text;
begin
 if (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_graph_rows_v1(uuid,uuid,text,text,jsonb)') and pg_catalog.pg_get_userbyid(p.proowner)='postgres') is distinct from '9093c357b20c31d0f16af9daaa9465d3' then
  raise exception using errcode='55000',message='account_complete_compatibility_predecessor_unavailable';end if;
 definition:=pg_catalog.pg_get_functiondef('public.export_archive_account_graph_rows_v1(uuid,uuid,text,text,jsonb)'::regprocedure);
 old_fragment:=$before_2_0$select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(permit->'partitions')x;$before_2_0$;
 new_fragment:=$after_2_0$select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into subjects from jsonb_array_elements(captured->'partitions')x;$after_2_0$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='account_complete_compatibility_predecessor_unavailable';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
end $legacy_subset_2$;
do $legacy_subset_3$
declare definition text;old_fragment text;new_fragment text;
begin
 if (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_graph_rows_v2(uuid,uuid,text,text,jsonb)') and pg_catalog.pg_get_userbyid(p.proowner)='postgres') is distinct from 'fb3711e8e02f504bd0711456e896df01' then
  raise exception using errcode='55000',message='account_complete_compatibility_predecessor_unavailable';end if;
 definition:=pg_catalog.pg_get_functiondef('public.export_archive_account_graph_rows_v2(uuid,uuid,text,text,jsonb)'::regprocedure);
 old_fragment:=$before_3_0$select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(permit->'partitions')x;$before_3_0$;
 new_fragment:=$after_3_0$select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into subjects from jsonb_array_elements(captured->'partitions')x;$after_3_0$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='account_complete_compatibility_predecessor_unavailable';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
end $legacy_subset_3$;
do $legacy_subset_4$
declare definition text;old_fragment text;new_fragment text;
begin
 if (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)') and pg_catalog.pg_get_userbyid(p.proowner)='postgres') is distinct from 'f163d47d32570962a712893fad1e2216' then
  raise exception using errcode='55000',message='account_complete_compatibility_predecessor_unavailable';end if;
 definition:=pg_catalog.pg_get_functiondef('public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)'::regprocedure);
 old_fragment:=$before_4_0$select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(permit->'partitions')x;$before_4_0$;
 new_fragment:=$after_4_0$select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into subjects from jsonb_array_elements(captured->'partitions')x;$after_4_0$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='account_complete_compatibility_predecessor_unavailable';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
end $legacy_subset_4$;
do $legacy_subset_5$
declare definition text;old_fragment text;new_fragment text;
begin
 if (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_members_pre_requester_v1(text,uuid,uuid,text,uuid,text)') and pg_catalog.pg_get_userbyid(p.proowner)='postgres') is distinct from '1e04b020763456c3c95ca362e3cae7d2' then
  raise exception using errcode='55000',message='account_complete_compatibility_predecessor_unavailable';end if;
 definition:=pg_catalog.pg_get_functiondef('public.export_archive_account_members_pre_requester_v1(text,uuid,uuid,text,uuid,text)'::regprocedure);
 old_fragment:=$before_5_0$'fileCount',capture#>'{authority,fileCount}'$before_5_0$;
 new_fragment:=$after_5_0$'fileCount',case when capture ? 'completeCapture' then (select to_jsonb(coalesce(sum((x->>'fileCount')::bigint),0)) from jsonb_array_elements(capture#>'{completeCapture,scopePartitions}')x where x->>'class'<>'consent-covered') else capture#>'{authority,fileCount}' end$after_5_0$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='account_complete_compatibility_predecessor_unavailable';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 -- Keep the historical thirteen-key emitted score contract closed. The whole
 -- computation receipt remains in the unchanged internal capture/hash census.
 old_fragment:=$before_5_1$to_jsonb(score)-'embryo_id'$before_5_1$;
 new_fragment:=$after_5_1$jsonb_build_object('id',score.id,'condition_id',score.condition_id,'condition_name',score.condition_name,'finding',score.finding,'evidence_label',score.evidence_label,'coverage_state',score.coverage_state,'citation_ids',score.citation_ids,'not_covered_reason',score.not_covered_reason,'model_id',score.model_id,'model_version',score.model_version,'source_binding_fingerprint',score.source_binding_fingerprint,'computation_revision',score.computation_revision,'computed_at',score.computed_at)$after_5_1$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>2 then
  raise exception using errcode='55000',message='account_complete_compatibility_predecessor_unavailable';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
end $legacy_subset_5$;
do $legacy_subset_6$
declare definition text;old_fragment text;new_fragment text;
begin
 if (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)') and pg_catalog.pg_get_userbyid(p.proowner)='postgres') is distinct from 'b88c74c6a3fa64fff3fac75858996ad0' then
  raise exception using errcode='55000',message='account_complete_compatibility_predecessor_unavailable';end if;
 definition:=pg_catalog.pg_get_functiondef('public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)'::regprocedure);
 old_fragment:=$before_6_0$capture:=private.export_account_owned_capture_v1(permit->'origin','account',account);$before_6_0$;
 new_fragment:=$after_6_0$capture:=private.export_account_owned_capture_v1(permit->'origin','account',account);
 if not exists(select 1 from jsonb_array_elements(capture->'partitions')x where x->>'subjectId'=p_subject_id::text) then raise exception using errcode='42501',message='not_found';end if;$after_6_0$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='account_complete_compatibility_predecessor_unavailable';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
end $legacy_subset_6$;
