-- Deployment-owned limits: no browser environment variable or demo cap.
-- Configure these from verified Storage capacity before enabling the route.
alter table private.upload_authorization_config
 add column maximum_array_bytes bigint check(maximum_array_bytes>0 and maximum_array_bytes<=9007199254740991),
 add column maximum_vcf_bytes bigint check(maximum_vcf_bytes>0 and maximum_vcf_bytes<=9007199254740991),
 add column maximum_account_bytes bigint check(maximum_account_bytes>0 and maximum_account_bytes<=9007199254740991),
 add column maximum_active_uploads integer check(maximum_active_uploads>0);
alter table public.upload_sessions
 add column maximum_decoded_bytes bigint check(maximum_decoded_bytes>0),
 add column finalization_claim uuid,
 add column final_object_name uuid unique,
 add column finalization_started_at timestamptz,
 add column finalization_cleanup_pending boolean not null default false,
 add column finalized_file_id uuid references public.genome_files(id) on delete set null;
create or replace function private.issue_own_storage_upload_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_declared_format text,p_size_bytes bigint,p_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c jsonb; u public.upload_sessions%rowtype; v_max bigint; v_not_after timestamptz; limits private.upload_authorization_config%rowtype; v_reserved numeric;
begin
 if p_declared_format is null or p_declared_format not in
  ('consumer-array-text-v1','consumer-array-text-v2','consumer-array-text-v3','consumer-array-text-v4','VCF','VCF.GZ','gVCF')
  or p_size_bytes is null or p_size_bytes<=0 or (p_sha256 is not null and p_sha256!~'^[0-9a-f]{64}$') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select * into limits from private.upload_authorization_config where singleton for share;
 if limits.maximum_array_bytes is null or limits.maximum_vcf_bytes is null
  or limits.maximum_account_bytes is null or limits.maximum_active_uploads is null then
  raise exception using errcode='55000',message='upload_unavailable'; end if;
 if p_subject_id is null then
  select id into p_subject_id from public.subjects where subject_account_id=p_account_id
   and subject_class='self' and lifecycle='active';
 end if;
 c:=private.own_upload_store_authority_v1(p_account_id,p_session_id,p_subject_id);
 v_max:=case when p_declared_format like 'consumer-array-text-v%' then limits.maximum_array_bytes else limits.maximum_vcf_bytes end;
 if p_size_bytes>v_max then raise exception using errcode='22023',message='file_too_large'; end if;
 -- The live authority helper holds the account lock, so concurrent issuers
 -- cannot each reserve the same remaining account allowance.
 select coalesce(sum(size_bytes),0) into v_reserved from public.genome_files where user_id=p_account_id;
 v_reserved:=v_reserved+(select coalesce(sum(expected_size),0) from public.upload_sessions
  where account_id=p_account_id and status in ('issued','uploaded','validating') and expires_at>clock_timestamp());
 if v_reserved+p_size_bytes>limits.maximum_account_bytes then
  raise exception using errcode='22023',message='file_too_large'; end if;
 if (select count(*) from public.upload_sessions where account_id=p_account_id
  and status in ('issued','uploaded','validating') and expires_at>clock_timestamp())>=limits.maximum_active_uploads then
  raise exception using errcode='55000',message='upload_unavailable'; end if;
 select not_after into v_not_after from auth.sessions where id=p_session_id and user_id=p_account_id;
 insert into public.upload_sessions(account_id,auth_session_id,subject_id,staging_object_name,expected_size,
  expected_sha256,content_type,upload_revision,status,expires_at,storage_bucket,token_jti,declared_format,
  account_revision,account_auth_session_revision,originating_session_revision,jurisdiction_revision,
  subject_binding_revision,account_binding_revision,subject_lifecycle_revision,upload_consent_id,maximum_decoded_bytes)
 values(p_account_id,p_session_id,p_subject_id,gen_random_uuid()::text,p_size_bytes,p_sha256,
  'application/octet-stream',1,'issued',least(clock_timestamp()+interval '30 minutes',v_not_after),
  'genomes',gen_random_uuid(),p_declared_format,(c->>'accountRevision')::bigint,
  (c->>'authSessionRevision')::bigint,(c->>'originatingSessionRevision')::bigint,
  (c->>'jurisdictionRevision')::bigint,(c->>'subjectBindingRevision')::bigint,
  (c->>'accountBindingRevision')::bigint,(c->>'subjectLifecycleRevision')::bigint,(c->>'uploadConsentId')::uuid,v_max)
 returning * into u;
 return jsonb_build_object('accountId',u.account_id,'sessionId',u.auth_session_id,
  'accountAuthSessionRevision',u.account_auth_session_revision,'uploadId',u.id,'jti',u.token_jti,
  'stagingKey',u.staging_object_name,'expiresAt',u.expires_at,'maximumBytes',u.expected_size);
end;
$function$;
revoke all on function private.issue_own_storage_upload_v1(uuid,uuid,uuid,text,bigint,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.issue_own_storage_upload_v1(uuid,uuid,uuid,text,bigint,text) to service_role;

create function private.own_upload_finalization_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid,p_claim uuid,p_start boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u public.upload_sessions%rowtype; locked_u public.upload_sessions%rowtype; c jsonb;
begin
 select * into u from public.upload_sessions where id=p_upload_id;
 if u.id is null or u.account_id is distinct from p_account_id or u.auth_session_id is distinct from p_session_id
  or u.token_jti is null or u.maximum_decoded_bytes is null then
  raise exception using errcode='42501',message='not_found'; end if;
 c:=private.own_upload_store_authority_v1(p_account_id,p_session_id,u.subject_id);
 select * into locked_u from public.upload_sessions where id=u.id for update;
 if to_jsonb(u) is distinct from to_jsonb(locked_u) or u.expires_at<=clock_timestamp()
  or c is distinct from jsonb_build_object('accountRevision',u.account_revision,'authSessionRevision',u.account_auth_session_revision,
   'jurisdictionRevision',u.jurisdiction_revision,'subjectBindingRevision',u.subject_binding_revision,
   'accountBindingRevision',u.account_binding_revision,'subjectLifecycleRevision',u.subject_lifecycle_revision,
   'originatingSessionRevision',u.originating_session_revision,'uploadConsentId',u.upload_consent_id) then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_start then
  if u.status='promoted' and u.finalized_file_id is not null then
   return jsonb_build_object('status','complete','fileId',u.finalized_file_id); end if;
  if u.status<>'uploaded' then raise exception using errcode='55000',message='upload_unavailable'; end if;
  update public.upload_sessions set status='validating',finalization_claim=gen_random_uuid(),
   final_object_name=gen_random_uuid(),finalization_started_at=clock_timestamp()
   where id=u.id returning * into u;
 elsif u.status<>'validating' or p_claim is null or u.finalization_claim is distinct from p_claim then
  raise exception using errcode='42501',message='not_found';
 end if;
 return jsonb_build_object('status','authorized','uploadId',u.id,'claim',u.finalization_claim,
  'bucket','genomes','stagingKey',u.staging_object_name,'finalKey',u.final_object_name,
  'expectedSize',u.expected_size,'expectedSha256',u.expected_sha256,'declaredFormat',u.declared_format,
  'maximumDecodedBytes',u.maximum_decoded_bytes);
exception when insufficient_privilege or object_not_in_prerequisite_state then
 raise exception using errcode='42501',message='not_found';
end;
$function$;
revoke all on function private.own_upload_finalization_v1(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_upload_finalization_v1(uuid,uuid,uuid,uuid,boolean) to service_role;

create function public.begin_own_upload_finalization_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $function$
 select private.own_upload_finalization_v1(p_account_id,p_session_id,p_upload_id,null,true);
$function$;
revoke all on function public.begin_own_upload_finalization_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.begin_own_upload_finalization_v1(uuid,uuid,uuid) to service_role;
create function public.authorize_own_upload_finalization_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid,p_claim uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $function$
 select private.own_upload_finalization_v1(p_account_id,p_session_id,p_upload_id,p_claim,false);
$function$;
revoke all on function public.authorize_own_upload_finalization_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.authorize_own_upload_finalization_v1(uuid,uuid,uuid,uuid) to service_role;

create function private.complete_own_upload_finalization_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid,
 p_claim uuid,p_storage_object_id uuid,p_raw_sha256 text,p_decoded_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare m jsonb; u public.upload_sessions%rowtype; f uuid; kind public.genome_file_type;
begin
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
revoke all on function private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;
create function public.complete_own_upload_finalization_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid,
 p_claim uuid,p_storage_object_id uuid,p_raw_sha256 text,p_decoded_sha256 text)
returns jsonb language sql security invoker set search_path=pg_catalog as $function$
 select private.complete_own_upload_finalization_v1(p_account_id,p_session_id,p_upload_id,p_claim,p_storage_object_id,p_raw_sha256,p_decoded_sha256);
$function$;
revoke all on function public.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;

-- Cleanup is allowed after consent/session revocation, but only for the exact
-- uncommitted lease. Claiming it atomically prevents a concurrent publication.
create function private.abort_own_upload_finalization_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid,p_claim uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u public.upload_sessions%rowtype;
begin
 select * into u from public.upload_sessions where id=p_upload_id for update;
 if u.account_id is distinct from p_account_id or u.auth_session_id is distinct from p_session_id
  or p_claim is null or u.finalization_claim is distinct from p_claim
  or u.status not in ('validating','rejected') or u.finalized_file_id is not null then
  raise exception using errcode='42501',message='not_found'; end if;
 update public.upload_sessions set status='rejected',consumed_at=coalesce(consumed_at,clock_timestamp()),
  finalization_cleanup_pending=true where id=u.id;
 return jsonb_build_object('bucket','genomes','stagingKey',u.staging_object_name,'finalKey',u.final_object_name);
end;
$function$;
revoke all on function private.abort_own_upload_finalization_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.abort_own_upload_finalization_v1(uuid,uuid,uuid,uuid) to service_role;
create function public.abort_own_upload_finalization_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid,p_claim uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $function$
 select private.abort_own_upload_finalization_v1(p_account_id,p_session_id,p_upload_id,p_claim);
$function$;
revoke all on function public.abort_own_upload_finalization_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.abort_own_upload_finalization_v1(uuid,uuid,uuid,uuid) to service_role;

create function private.ack_own_upload_finalization_cleanup_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid,p_claim uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u public.upload_sessions%rowtype;
begin
 select * into u from public.upload_sessions where id=p_upload_id for update;
 if u.account_id is distinct from p_account_id or u.auth_session_id is distinct from p_session_id
  or p_claim is null or u.finalization_claim is distinct from p_claim or u.status<>'rejected'
  or u.finalized_file_id is not null or exists(select 1 from storage.objects where bucket_id='genomes'
   and name in (u.staging_object_name,u.final_object_name::text)) then
  raise exception using errcode='42501',message='not_found'; end if;
 update public.upload_sessions set finalization_cleanup_pending=false where id=u.id;
 return true;
end;
$function$;
revoke all on function private.ack_own_upload_finalization_cleanup_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.ack_own_upload_finalization_cleanup_v1(uuid,uuid,uuid,uuid) to service_role;
create function public.ack_own_upload_finalization_cleanup_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid,p_claim uuid)
returns boolean language sql security invoker set search_path=pg_catalog as $function$
 select private.ack_own_upload_finalization_cleanup_v1(p_account_id,p_session_id,p_upload_id,p_claim);
$function$;
revoke all on function public.ack_own_upload_finalization_cleanup_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.ack_own_upload_finalization_cleanup_v1(uuid,uuid,uuid,uuid) to service_role;

create function private.guard_structural_file_identity_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $function$
begin
 if new.single_logical_sample_verified_at is not null
  and current_user not in ('postgres','service_role','supabase_admin') then
  raise exception using errcode='42501',message='file_authority_required'; end if;
 if tg_op='UPDATE' and old.single_logical_sample_verified_at is not null
  and (new.user_id,new.subject_id,new.bucket_path,new.storage_object_id,new.size_bytes,new.sha256,
   new.source_sha256,new.structural_validator_version,new.single_logical_sample_verified_at)
  is distinct from (old.user_id,old.subject_id,old.bucket_path,old.storage_object_id,old.size_bytes,old.sha256,
   old.source_sha256,old.structural_validator_version,old.single_logical_sample_verified_at) then
  raise exception using errcode='55000',message='immutable_file_identity'; end if;
 return new;
end;
$function$;
revoke all on function private.guard_structural_file_identity_v1() from public,anon,authenticated,inherit_upload_only;
create trigger guard_structural_file_identity before insert or update on public.genome_files
 for each row execute function private.guard_structural_file_identity_v1();
