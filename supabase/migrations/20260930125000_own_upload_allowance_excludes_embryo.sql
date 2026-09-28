-- Owner decision, 28 September 2026: embryo sources do not count against the
-- parent's own upload allowance. A published embryo canonical source is a
-- `genome_files` row owned by the cohort owner (20260930123000); summing every
-- row by `user_id` counted it, invisibly, against the owner's own files.
--
-- `private.own_upload_account_bytes_v1` is now the one account byte total
-- both readers use: issuance (`issue_own_storage_upload_v1`) and the limit
-- disclosure (`own_upload_limits_v1`). It leaves out a cohort row and any row
-- on an embryo subject. Each function below is 20260918150000's current body
-- with only that line changed; grants, ownership and search_path are
-- unchanged by create or replace. Embryo ingest keeps its own payload limits.

create function private.own_upload_account_bytes_v1(p_account_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(f.size_bytes), 0)::numeric from public.genome_files f
  where f.user_id = p_account_id and f.cohort_id is null
    and not exists (select 1 from public.subjects s where s.id = f.subject_id and s.subject_class = 'embryo');
$$;
revoke all on function private.own_upload_account_bytes_v1(uuid)
  from public, anon, authenticated, inherit_upload_only, service_role;

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
 v_max:=case when p_declared_format like 'consumer-array-text-v%' then limits.maximum_array_bytes
  when p_declared_format='gVCF' then coalesce(limits.maximum_gvcf_bytes,limits.maximum_vcf_bytes) else limits.maximum_vcf_bytes end;
 if p_size_bytes>v_max then raise exception using errcode='22023',message='file_too_large'; end if;
 -- The live authority helper holds the account lock, so concurrent issuers
 -- cannot each reserve the same remaining account allowance.
 v_reserved:=private.own_upload_account_bytes_v1(p_account_id);
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

create or replace function private.own_upload_limits_v1(p_account_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare limits private.upload_authorization_config%rowtype; v_reserved numeric; v_active bigint;
begin
 if p_account_id is null or p_session_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 -- A live session of this exact account only. This discloses deployment
 -- capacity and one account's own byte total, never another account's.
 if not exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_account_id
  and (s.not_after is null or s.not_after>clock_timestamp())) then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into limits from private.upload_authorization_config where singleton for share;
 if limits.maximum_array_bytes is null or limits.maximum_vcf_bytes is null
  or limits.maximum_account_bytes is null or limits.maximum_active_uploads is null then
  raise exception using errcode='55000',message='upload_unavailable'; end if;
 v_reserved:=private.own_upload_account_bytes_v1(p_account_id);
 select v_reserved+coalesce(sum(expected_size),0),count(*) into v_reserved,v_active
  from public.upload_sessions where account_id=p_account_id
  and status in('issued','uploaded','validating') and expires_at>clock_timestamp();
 return jsonb_build_object('maximumArrayBytes',limits.maximum_array_bytes,
  'maximumVcfBytes',limits.maximum_vcf_bytes,'maximumGvcfBytes',coalesce(limits.maximum_gvcf_bytes,limits.maximum_vcf_bytes),
  'maximumAccountBytes',limits.maximum_account_bytes,
  'maximumActiveUploads',limits.maximum_active_uploads,'reservedBytes',v_reserved::bigint,
  'activeUploads',v_active);
end;
$function$;
