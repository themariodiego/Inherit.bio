-- G5.3/G5.4: the same native Path B notice supplies the safe uploader label.
-- Only the account's plain display name is captured; it is not verified identity.
-- Existing finalization, recipient, fixed deadline, quarantine and nonce guards
-- remain exact. No new table, credential, grant, issuer or analysis transition.
create or replace function private.complete_own_upload_finalization_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid,
 p_claim uuid,p_storage_object_id uuid,p_raw_sha256 text,p_decoded_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare m jsonb; u public.upload_sessions%rowtype; f uuid; kind public.genome_file_type;
 v_kind text; v_deadline timestamptz; v_held_at timestamptz; r uuid; t jsonb; v_revision uuid; v_outbox uuid;
begin
 -- 20260928150000: a held upload serializes with the invitation and rights
 -- transitions (activation, confirmation, refusal) before its authority is read.
 select upload_authority_kind into v_kind from public.upload_sessions where id=p_upload_id;
 if v_kind='other-adult-held' then perform private.lock_invitation_transitions_v1(); end if;
 m:=private.own_upload_finalization_v1(p_account_id,p_session_id,p_upload_id,p_claim,false);
 select * into u from public.upload_sessions where id=p_upload_id;
 if p_raw_sha256 is null or p_raw_sha256!~'^[0-9a-f]{64}$'
  or p_decoded_sha256 is null or p_decoded_sha256!~'^[0-9a-f]{64}$'
  or (u.expected_sha256 is not null and p_raw_sha256<>u.expected_sha256)
  or exists(select 1 from storage.objects where bucket_id='genomes' and name=u.staging_object_name)
  or not exists(select 1 from storage.objects where id=p_storage_object_id and bucket_id='genomes'
   and name=u.final_object_name::text and (metadata->>'size')::numeric=u.expected_size) then
  raise exception using errcode='42501',message='upload_unavailable'; end if;
 kind:=(case u.declared_format when 'consumer-array-text-v1' then 'array_23andme'
  when 'consumer-array-text-v2' then 'array_ancestry' when 'consumer-array-text-v3' then 'array_myheritage'
  when 'consumer-array-text-v4' then 'array_ftdna' when 'gVCF' then 'gvcf' else 'vcf' end)::public.genome_file_type;
 -- 20260928150000: another adult's file stops here. No genome_files row, no
 -- genome_storage_objects row and no job exist; the validated object is
 -- recorded only in the held revision, which no reader reads. The same commit
 -- queues the upload-time notice and its confirmation credential, or nothing
 -- commits (upload-time-rights-notice-v1.transaction).
 if u.upload_authority_kind='other-adult-held' then
  t:=private.path_b_subject_v1(p_account_id,u.subject_id);
  v_revision:=gen_random_uuid();
  v_held_at:=clock_timestamp();
  v_deadline:=v_held_at+interval '30 days';
  insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
   recipient_authority_revision,semantic_revision,idempotency_key,token_purpose,token_target_id,template_payload,expires_at)
  values('adult-upload-notice','adult-upload-confirmation','adult_upload_revision',v_revision,(t->>'principalId')::uuid,
   (t->>'contactReferenceId')::uuid,(t->>'principalRevision')::bigint,u.upload_revision,
   encode(extensions.digest(convert_to('adult-upload-notice-v1:'||v_revision::text,'UTF8'),'sha256'),'hex'),
   'adult-upload-confirmation',v_revision,
   jsonb_build_object('fileKind',case when kind::text like 'array_%' then 'array' else 'vcf' end,
    'uploaderName',private.embryo_notice_display_name_v1(p_account_id),
    'uploadedOn',to_char(timezone('UTC',v_held_at),'YYYY-MM-DD'),
    'deleteBy',to_char(timezone('UTC',v_deadline),'YYYY-MM-DD')),
   v_deadline)
  returning id into v_outbox;
  insert into public.token_candidates(outbox_id,purpose,target_kind,target_id,token_revision,state,expires_at)
  values(v_outbox,'adult-upload-confirmation','adult_upload_revision',v_revision,1,'pending',v_deadline);
  insert into public.other_adult_held_uploads(id,upload_session_id,subject_id,uploader_account_id,uploader_consent_id,
   confirmation_principal_id,subject_binding_revision,storage_object_id,object_name,file_type,size_bytes,raw_sha256,
   decoded_sha256,upload_revision,held_at,fixed_deadline,notice_outbox_id)
  values(v_revision,u.id,u.subject_id,p_account_id,u.upload_consent_id,(t->>'principalId')::uuid,
   (t->>'subjectBindingRevision')::bigint,p_storage_object_id,u.final_object_name::text,kind,u.expected_size,
   p_raw_sha256,p_decoded_sha256,u.upload_revision,v_held_at,v_deadline,v_outbox);
  update public.upload_sessions set status='held' where id=u.id;
  delete from private.own_upload_finalization_attempts where upload_id=u.id;
  -- adult.unconfirmed-30d: the registered clock for another adult's unconfirmed file.
  insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
   disposition_revision,fixed_deadline)
  values('adult.unconfirmed-30d','upload_session',u.id,u.upload_revision,u.upload_revision,1,v_deadline)
  returning id into r;
  insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
   target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,
   immutable_envelope)
  values(r,'adult.unconfirmed-30d','adult-unconfirmed-source-expiry','compound-atomic',1,v_deadline,'upload_session',u.id,
   u.upload_revision,1,'service-retention',1,jsonb_build_object('uploadId',u.id,'uploadRevision',u.upload_revision));
  perform private.append_legal_audit_event('upload.held',null,'api.file-finalize','accepted',
   jsonb_build_object('upload_class','other_adult','revision',u.upload_revision));
  return jsonb_build_object('fileId',v_revision,'status','stored_quarantined','analysisState','quarantined',
   'noticeState','queued');
 end if;
 insert into public.genome_files(user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
  upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values(p_account_id,u.subject_id,u.final_object_name::text,'Genome file',kind,1,u.expected_size,p_raw_sha256,'uploaded',
  u.upload_revision,'single-logical-sample-v1',clock_timestamp(),p_decoded_sha256,p_storage_object_id) returning id into f;
 insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values(p_storage_object_id,u.final_object_name::text,'genomes',f,p_raw_sha256,u.expected_size,u.upload_revision,'current');
 update public.upload_sessions set status='promoted',consumed_at=clock_timestamp(),finalized_file_id=f where id=u.id;
 return jsonb_build_object('fileId',f,'status','finalized_ready_for_processing','analysisState','ready_for_processing',
  'next',jsonb_build_object('routeId','api.file-process','operation','process'));
end;
$function$;

revoke all on function private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;

create or replace function public.read_adult_upload_revision_v1(p_session_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare r jsonb; uploader_name jsonb;
begin
 r:=private.adult_upload_revision_session_v1(p_session_hash);
 if r is null then return null; end if;
 -- The safe name captured by this exact upload's notice, not a request field
 -- or a later profile edit. Older queued notices have the honest null fallback.
 select case when jsonb_typeof(m.template_payload->'uploaderName')='string'
   and m.template_payload->>'uploaderName' ~ '^[[:alpha:]][[:alpha:] .''-]{0,59}$'
  then m.template_payload->'uploaderName' else 'null'::jsonb end into uploader_name
 from public.other_adult_held_uploads h join public.mail_outbox m on m.id=h.notice_outbox_id
 where h.id=(r->>'revisionId')::uuid and m.target_id=h.id
  and m.template_id='adult-upload-notice' and m.purpose='adult-upload-confirmation';
 return (r-'sessionId'-'revisionId'-'subjectId')
  ||jsonb_build_object('uploaderName',coalesce(uploader_name,'null'::jsonb));
end;
$function$;
revoke all on function public.read_adult_upload_revision_v1(text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.read_adult_upload_revision_v1(text) to service_role;
