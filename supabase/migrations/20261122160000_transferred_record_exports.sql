-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It changes what a transferred Path B record exports,
-- what an uploader's hand-over refused for now answers, and one closed list
-- of the legal audit; Path B is TEST-LOCAL only, so in production no record
-- any of it reaches can exist. It follows 20261001039000 (the two export
-- bodies it patches), 20261016221000 (the transfer and its post-transfer
-- reading helpers), 20261119170000 (the person-caused event list it widens),
-- 20261122100000 (the transfer body it patches) and 20261122130000 (the
-- own-source body it patches); it goes into release 4 after 20261122120000.
-- =====================================================================
--
-- Three owner decisions and defect rows of 22 November 2026
-- (docs/protocol/decisions.md, docs/protocol/defects.md):
--
--   1. D-162. After a transfer (the person's own move, or the uploader's
--      hand-over) the record is the person's: its files are rebound to them
--      and the Path B readers have a transferred branch
--      (private.transferred_subject_result_read_v1,
--      private.transferred_report_binding_current_v1, 20261016221000). The
--      export capture had none: it still asked private.path_b_person_v1 and
--      private.path_b_subject_v1, which refuse a record its person owns, so
--      the person could make no new export of the record or of their whole
--      account, and "Download your data" listed none of its files. The
--      approved new-owner emails say "You can make a new one." Here:
--        - two read helpers answer for a transferred record what the two
--          Path B helpers answer before a transfer: the person's own current
--          principal, session and account, and the record's confirmation
--          (the draft and signature as the uploader's request left them, the
--          person's own principal and contact); no uploader identity;
--        - private.export_account_ordinary_readable_authority_v1 and
--          private.export_account_path_b_snapshot_v1 (the whole-account and
--          per-record captures of a Path B record) ask them for a transferred
--          record, find the draft under the account that made it, and read
--          the person's saved results through the transferred reader's own
--          currency check, as private.path_b_report_results_v1 does; a file
--          without a saved result of the person's has nothing to project (the
--          transfer deleted every other result), so it is no longer a
--          refusal for a transferred record;
--        - private.own_export_source_v1 (every own-source read, including
--          "Download your data") accepts a file transferred to the caller:
--          the person's own principal on the record and the transfer row
--          stand in for the ordinary binding row a Path B record never has;
--          before the relocation worker's swap the file is read through the
--          exact object the transfer recorded (its relocation row, still
--          queued or copying, the same key, size and hash), after it through
--          its own storage object as before; its Path B normalization counts.
--      A record not transferred, and every other account (the former
--      uploader included), reads exactly as before.
--   2. D-158, owner decision "A hand-over refused for now says to try later
--      (D-158)": private.transfer_subject_v1, on the uploader's withdrawal
--      only, raises 55000 hand_over_not_now (not 42501 not_found) for the
--      three refusals that pass: a file still being validated, a file of an
--      unexpected shape, the person's account gone. The route answers it
--      with its own response; the card says "This cannot be done right now.
--      Nothing was deleted. Try again later." Nothing is written, as before;
--      the person's own act and every other refusal are unchanged.
--   3. D-159: private.legal_audit_person_event_v1 gains the pair the
--      hand-over records, ('api.subject-delete','subject.ownership_transferred').
--
-- Every body changed here is md5-guarded with its exact reviewed ACL, one
-- anchor per patch, the successor md5 and unchanged ACL asserted (55000
-- otherwise); the two helpers are new and callable by no API role.

do $predecessor$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)')
   and md5(pg_get_functiondef(p.oid))='611957debd6025a4f5c4710a596d67cf' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.export_account_path_b_snapshot_v1(jsonb,uuid)')
   and md5(pg_get_functiondef(p.oid))='4cc6a1afc5be8b0d8163f3c14a6f23e8' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.own_export_source_v1(uuid,uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='27abc582be0eb4a227a7cdeb57c29d6f'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)')
   and md5(pg_get_functiondef(p.oid))='e481de5f5eab53b6c596da66bc7b30fa' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.legal_audit_person_event_v1(text,text)')
   and md5(pg_get_functiondef(p.oid))='73bd0200b7e272bec503eab70499e877' and p.proacl::text='{postgres=X/postgres}')
  -- What the patched bodies keep calling, unchanged: the Path B test of a
  -- file, the two Path B helpers, the transferred reader's currency check
  -- and the account currency check.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.export_account_path_b_file_v1(uuid)')
   and md5(pg_get_functiondef(p.oid))='71e1c10e7b5410f4cb4b77c7ccc10577' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.path_b_person_v1(uuid,uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='9f0434499b394a5c8ece4151838918e3' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.path_b_subject_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='d174a83682e35479797ac7e738a65d79'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.transferred_report_binding_current_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='07229b62253f40cc419a32c4b34b1099' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.path_b_account_current_v1(uuid)')
   and md5(pg_get_functiondef(p.oid))='6372a00f8c0f10e512a31dcf7455333b' and p.proacl::text='{postgres=X/postgres}')
  or to_regprocedure('private.transferred_export_person_v1(uuid,uuid,uuid)') is not null
  or to_regprocedure('private.transferred_export_confirmation_v1(uuid)') is not null then
  raise exception using errcode='55000',message='transferred record exports prerequisite differs'; end if;
end;
$predecessor$;

-- 1. The two read helpers ---------------------------------------------------------------
-- What private.path_b_person_v1 answers before a transfer, for a record
-- transferred to the caller: a live session, an account current for
-- analysis, the record theirs by its one transfer, the confirmed request the
-- uploader made, and their own active principal on it. No uploader identity.
create function private.transferred_export_person_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.subjects%rowtype; t private.subject_ownership_transfers%rowtype; p public.subject_principals%rowtype;
 pr public.profiles%rowtype;
begin
 perform 1 from auth.sessions x where x.id=p_session_id and x.user_id=p_account_id
  and (x.not_after is null or x.not_after>clock_timestamp());
 if not found or not private.path_b_account_current_v1(p_account_id) then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into s from public.subjects where id=p_subject_id and subject_class='other_adult' and upload_class='adult'
  and lifecycle='active' and ownership_transferred_at is not null
  and owner_account_id=p_account_id and subject_account_id=p_account_id for share;
 select * into t from private.subject_ownership_transfers where subject_id=s.id and to_account_id=p_account_id;
 if s.id is null or t.id is null or not exists(select 1 from public.adult_subject_drafts d where d.subject_id=s.id
   and d.owner_account_id=t.from_account_id and d.adult_flow='path-b-subject-esignature' and d.state='confirmed') then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into p from public.subject_principals where subject_id=s.id and principal_kind='account_subject'
  and account_id=p_account_id and status='active' for share;
 select * into pr from public.profiles where id=p_account_id for share;
 if p.id is null or pr.id is null then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('subjectId',s.id,'subjectBindingRevision',s.subject_binding_revision,
  'principalId',p.id,'principalRevision',p.principal_revision,'uploaderAccountId',null,'uploaderPrincipalId',null,
  'jurisdictionCode',pr.jurisdiction_code,'jurisdictionRevision',pr.jurisdiction_revision);
end $$;
revoke all on function private.transferred_export_person_v1(uuid,uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- What private.path_b_subject_v1 answers before a transfer, for a record
-- transferred to its person: the confirmed e-signature request as the
-- uploader's account made it, the person's own principal, its current
-- contact and the confirmation signature.
create function private.transferred_export_confirmation_v1(p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.subjects%rowtype; t private.subject_ownership_transfers%rowtype; d public.adult_subject_drafts%rowtype;
 p public.subject_principals%rowtype; e public.encrypted_contact_references%rowtype; v_signature uuid;
begin
 select * into s from public.subjects where id=p_subject_id and subject_class='other_adult' and upload_class='adult'
  and lifecycle='active' and ownership_transferred_at is not null and owner_account_id=subject_account_id for share;
 select * into t from private.subject_ownership_transfers where subject_id=s.id and to_account_id=s.subject_account_id;
 if s.id is null or t.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select * into d from public.adult_subject_drafts where subject_id=s.id and owner_account_id=t.from_account_id
  and adult_flow='path-b-subject-esignature' and evidence_kind='esignature' and state='confirmed' for share;
 if d.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select * into p from public.subject_principals where subject_id=s.id and status='active'
  and principal_kind='account_subject' and account_id=s.subject_account_id for share;
 if p.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select * into e from public.encrypted_contact_references where principal_id=p.id and status='current'
  and contact_ciphertext is not null and authority_revision=p.principal_revision for share;
 if e.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select cs.id into v_signature from public.consent_signatures cs
 join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
  and ca.body_sha256=cs.artifact_body_sha256
 where cs.target_kind='subject' and cs.target_id=s.id and cs.signer_principal_id=p.id and cs.signer_account_id=p.account_id
  and cs.purpose='adult-subject-path-b-confirmation' and cs.subject_binding_revision=s.subject_binding_revision
  and ca.artifact_key='consent.subject-adult-esignature'
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 order by cs.signed_at desc limit 1;
 if v_signature is null then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('subjectBindingRevision',s.subject_binding_revision,
  'subjectLifecycleRevision',s.lifecycle_revision,'principalId',p.id,'principalRevision',p.principal_revision,
  'contactReferenceId',e.id,'confirmationSignatureId',v_signature);
end $$;
revoke all on function private.transferred_export_confirmation_v1(uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 2. Bodies patched in place --------------------------------------------------------------
do $patch_transferred$
declare item record;definition text;before_acl aclitem[];
begin
 for item in select * from (values
  -- The whole-account and per-record capture of a Path B record.
  (1,'private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)','611957debd6025a4f5c4710a596d67cf',
   '787d0e8ef75f3ba30512f5d6e73f2309','{postgres=X/postgres}',
   $old$   person:=private.path_b_person_v1(a,sess,s.id);
   confirmation:=private.path_b_subject_v1(s.owner_account_id,s.id);$old$,
   $new$   -- 20261122160000 (D-162): a record transferred to its person is
   -- captured through the same confirmation, the person now its owner.
   if s.ownership_transferred_at is not null then
    person:=private.transferred_export_person_v1(a,sess,s.id);
    confirmation:=private.transferred_export_confirmation_v1(s.id);
   else
    person:=private.path_b_person_v1(a,sess,s.id);
    confirmation:=private.path_b_subject_v1(s.owner_account_id,s.id);
   end if;$new$,
   'readable authority helpers'),
  (2,'private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)','787d0e8ef75f3ba30512f5d6e73f2309',
   '583e9efa4a60f086e3875fc40e03f491','{postgres=X/postgres}',
   $old$   where d.subject_id=s.id and d.owner_account_id=s.owner_account_id and d.state='confirmed'$old$,
   $new$   -- 20261122160000 (D-162): a transferred record's request stays the uploader's.
   where d.subject_id=s.id and d.owner_account_id=coalesce((select t.from_account_id from private.subject_ownership_transfers t
     where t.subject_id=s.id and t.to_account_id=a and s.ownership_transferred_at is not null),s.owner_account_id)
    and d.state='confirmed'$new$,
   'readable authority draft'),
  -- The person's saved results of a Path B record, in either capture.
  (3,'private.export_account_path_b_snapshot_v1(jsonb,uuid)','4cc6a1afc5be8b0d8163f3c14a6f23e8',
   '354784878844e12e2a74c1b9b5566a7a','{postgres=X/postgres}',
   $old$ perform private.path_b_person_v1((p_origin->>'accountId')::uuid,(p_origin->>'sessionId')::uuid,s.id);$old$,
   $new$ -- 20261122160000 (D-162): the person of a record transferred to them.
 if s.ownership_transferred_at is not null then
  perform private.transferred_export_person_v1((p_origin->>'accountId')::uuid,(p_origin->>'sessionId')::uuid,s.id);
 else
  perform private.path_b_person_v1((p_origin->>'accountId')::uuid,(p_origin->>'sessionId')::uuid,s.id);
 end if;$new$,
   'snapshot person'),
  (4,'private.export_account_path_b_snapshot_v1(jsonb,uuid)','354784878844e12e2a74c1b9b5566a7a',
   'c5cf3bbf75e8b758cdd5600d5db54dda','{postgres=X/postgres}',
   $old$  a:=private.path_b_report_authority_v1(b.file_id,b.grant_id,'export-source-read');
  if a is distinct from b.authority or a->>'direction'<>'self'
   or a->>'recipientAccountId' is distinct from p_origin->>'accountId'
   or(a->>'authorityExpiresAt')::timestamptz<=clock_timestamp() then
   raise exception using errcode='42501',message='not_found';end if;$old$,
   $new$  -- 20261122160000 (D-162): a transferred record's saved result is the
  -- person's while their own grant that produced it is current, exactly as
  -- private.path_b_report_results_v1 reads it after a transfer.
  if s.ownership_transferred_at is not null then
   if not private.transferred_report_binding_current_v1(b.id,(p_origin->>'accountId')::uuid) then
    raise exception using errcode='42501',message='not_found';end if;
   a:=b.authority;
   if a->>'direction' is distinct from 'self' or a->>'recipientAccountId' is distinct from p_origin->>'accountId' then
    raise exception using errcode='42501',message='not_found';end if;
  else
  a:=private.path_b_report_authority_v1(b.file_id,b.grant_id,'export-source-read');
  if a is distinct from b.authority or a->>'direction'<>'self'
   or a->>'recipientAccountId' is distinct from p_origin->>'accountId'
   or(a->>'authorityExpiresAt')::timestamptz<=clock_timestamp() then
   raise exception using errcode='42501',message='not_found';end if;
  end if;$new$,
   'snapshot saved results'),
  (5,'private.export_account_path_b_snapshot_v1(jsonb,uuid)','c5cf3bbf75e8b758cdd5600d5db54dda',
   'b9ae87c681a443f9ac3fb1846a69520b','{postgres=X/postgres}',
   $old$ for f in select gf.* from public.genome_files gf where gf.subject_id=s.id and private.export_account_path_b_file_v1(gf.id)
  and not exists($old$,
   $new$ -- 20261122160000 (D-162): after a transfer only the person's own saved
 -- results remain (the transfer deleted every other); a file without one has
 -- nothing to project.
 for f in select gf.* from public.genome_files gf where gf.subject_id=s.id and private.export_account_path_b_file_v1(gf.id)
  and s.ownership_transferred_at is null
  and not exists($new$,
   'snapshot files without a result'),
  -- Every own-source read: a file transferred to the caller.
  (6,'private.own_export_source_v1(uuid,uuid,uuid)','27abc582be0eb4a227a7cdeb57c29d6f',
   '16a9b2aac1b238bd13f1e90763d3a581','{postgres=X/postgres,service_role=X/postgres}',
   $old$ published jsonb; manifest_id uuid; result jsonb;$old$,
   $new$ published jsonb; manifest_id uuid; result jsonb;
 t private.subject_ownership_transfers%rowtype; r private.subject_transfer_relocations%rowtype; transferred boolean:=false;$new$,
   'own source declarations'),
  (7,'private.own_export_source_v1(uuid,uuid,uuid)','16a9b2aac1b238bd13f1e90763d3a581',
   '8be04e7de37680c7a823e254d109aebb','{postgres=X/postgres,service_role=X/postgres}',
   $old$ if b.id is null or sp.id is null or ap.id is null then return null; end if;$old$,
   $new$ -- 20261122160000 (D-162): a file transferred to the caller. A Path B record
 -- never has an ordinary binding row; after its transfer the person's own
 -- active principal on it and the one transfer row stand in for one.
 if b.id is null and s.subject_class='other_adult' and s.ownership_transferred_at is not null
  and s.owner_account_id=p_account_id and f.user_id=p_account_id
  and not exists(select 1 from private.genome_file_deletions d where d.file_id=f.id) then
  select * into t from private.subject_ownership_transfers where subject_id=s.id and to_account_id=p_account_id;
  select * into sp from public.subject_principals where subject_id=s.id and account_id=p_account_id
   and principal_kind='account_subject' and status='active';
  if t.id is not null and sp.id is not null then
   b.id:=t.id; b.binding_revision:=t.transfer_revision; ap:=sp; transferred:=true;
  end if;
 end if;
 if b.id is null or sp.id is null or ap.id is null then return null; end if;$new$,
   'own source binding'),
  (8,'private.own_export_source_v1(uuid,uuid,uuid)','8be04e7de37680c7a823e254d109aebb',
   'e19024a6cec72802e6ba5feb8f273f85','{postgres=X/postgres,service_role=X/postgres}',
   $old$   and obj.bucket_id=o.bucket_id and obj.name=o.object_name and (obj.metadata->>'size')::numeric=f.size_bytes;
 if not found then return null; end if;$old$,
   $new$   and obj.bucket_id=o.bucket_id and obj.name=o.object_name and (obj.metadata->>'size')::numeric=f.size_bytes;
 -- 20261122160000 (D-162): before the relocation worker's swap a transferred
 -- file is read through the exact object its transfer recorded.
 if not found and transferred and f.storage_object_id is null then
  select * into r from private.subject_transfer_relocations where file_id=f.id and transfer_id=t.id
   and new_owner_account_id=p_account_id and state in ('queued','copying');
  perform 1 from storage.objects obj where r.id is not null and obj.id=r.old_object_id and obj.bucket_id='genomes'
   and obj.name=r.old_object_key and obj.name=f.bucket_path and r.sha256=f.sha256 and r.byte_count=f.size_bytes
   and (obj.metadata->>'size')::numeric=f.size_bytes;
 end if;
 if not found then return null; end if;$new$,
   'own source object'),
  (9,'private.own_export_source_v1(uuid,uuid,uuid)','e19024a6cec72802e6ba5feb8f273f85',
   '246f77608b8cf51f7aa6881eba748a34','{postgres=X/postgres,service_role=X/postgres}',
   $old$  and n.manifest->>'objectId'=f.storage_object_id::text and n.manifest->>'objectKey'=f.bucket_path) into normalized;$old$,
   $new$  and n.manifest->>'objectId'=f.storage_object_id::text and n.manifest->>'objectKey'=f.bucket_path) into normalized;
 -- 20261122160000 (D-162): a transferred file was normalized as a Path B file.
 if transferred and not normalized then
  normalized:=f.normalization_completed_at is not null and f.normalization_source_revision=f.upload_revision
   and f.variant_count is not null;
 end if;$new$,
   'own source normalization'),
  (10,'private.own_export_source_v1(uuid,uuid,uuid)','246f77608b8cf51f7aa6881eba748a34',
   'a8000a6cccd2fce9c2b285ab268ed642','{postgres=X/postgres,service_role=X/postgres}',
   $old$'storage_object_id',f.storage_object_id,'upload_revision',f.upload_revision),$old$,
   $new$'storage_object_id',coalesce(f.storage_object_id,r.old_object_id),'upload_revision',f.upload_revision),$new$,
   'own source object id'),
  -- D-158: the hand-over refused for now.
  (11,'private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','e481de5f5eab53b6c596da66bc7b30fa',
   '8aab3bc5afe15b561e683a53178b5c5b','{postgres=X/postgres}',
   $old$ if not exists(select 1 from auth.users u where u.id=v_new and u.deleted_at is null) then
  raise exception using errcode='42501',message='not_found'; end if;$old$,
   $new$ if not exists(select 1 from auth.users u where u.id=v_new and u.deleted_at is null) then
  -- 20261122160000 (D-158): on the withdrawal, refused for now.
  raise exception using errcode=case when v_withdrawal then '55000' else '42501' end,
   message=case when v_withdrawal then 'hand_over_not_now' else 'not_found' end; end if;$new$,
   'transfer account gone'),
  (12,'private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','8aab3bc5afe15b561e683a53178b5c5b',
   '3db5e291555b02bb3e925396740d438a','{postgres=X/postgres}',
   $old$  or exists(select 1 from public.upload_sessions u where u.subject_id=s.id and u.status='validating') then
  raise exception using errcode='42501',message='not_found'; end if;$old$,
   $new$  or exists(select 1 from public.upload_sessions u where u.subject_id=s.id and u.status='validating') then
  -- 20261122160000 (D-158): on the withdrawal, refused for now.
  raise exception using errcode=case when v_withdrawal then '55000' else '42501' end,
   message=case when v_withdrawal then 'hand_over_not_now' else 'not_found' end; end if;$new$,
   'transfer file validating'),
  (13,'private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','3db5e291555b02bb3e925396740d438a',
   '0bb151e8b9849da4f6671237efc3d4c4','{postgres=X/postgres}',
   $old$    or f.cohort_id is not null)) then
  raise exception using errcode='42501',message='not_found'; end if;$old$,
   $new$    or f.cohort_id is not null)) then
  -- 20261122160000 (D-158): on the withdrawal, refused for now.
  raise exception using errcode=case when v_withdrawal then '55000' else '42501' end,
   message=case when v_withdrawal then 'hand_over_not_now' else 'not_found' end; end if;$new$,
   'transfer file shape'),
  -- D-159: the hand-over's event is a person-caused event of the route it is recorded on.
  (14,'private.legal_audit_person_event_v1(text,text)','73bd0200b7e272bec503eab70499e877',
   'f06ad94838f724581b457e800162a6bb','{postgres=X/postgres}',
   $old$      ('api.consent-revoke','embryo.upload-consent.withdrawn')),false);$old$,
   $new$      ('api.consent-revoke','embryo.upload-consent.withdrawn'),
      -- 20261122160000 (D-159): the uploader's hand-over, recorded on the route it used.
      ('api.subject-delete','subject.ownership_transferred')),false);$new$,
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
$patch_transferred$;

-- Postflight: the five patched bodies as written, the two helpers private.
do $postflight$
begin
 if not exists(select 1 from pg_proc p where p.oid='private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='583e9efa4a60f086e3875fc40e03f491' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.export_account_path_b_snapshot_v1(jsonb,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='b9ae87c681a443f9ac3fb1846a69520b' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.own_export_source_v1(uuid,uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='a8000a6cccd2fce9c2b285ab268ed642'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='0bb151e8b9849da4f6671237efc3d4c4' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.legal_audit_person_event_v1(text,text)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='f06ad94838f724581b457e800162a6bb' and p.proacl::text='{postgres=X/postgres}')
  or (select count(*) from pg_proc p where p.oid in (to_regprocedure('private.transferred_export_person_v1(uuid,uuid,uuid)'),
    to_regprocedure('private.transferred_export_confirmation_v1(uuid)'))
   and p.prosecdef and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres}')<>2 then
  raise exception using errcode='55000',message='transferred record exports successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
