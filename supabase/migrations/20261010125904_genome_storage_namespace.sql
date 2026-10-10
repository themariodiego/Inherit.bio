-- New ordinary-subject bytes use the registered account/subject/upload namespace.
-- Existing flat UUID locators are kept byte-for-byte; no Storage object is moved.
-- Names are locators only. All existing session, exact-key, consent, quarantine,
-- revision, recovery, range-read and deletion authority remains independently required.

create function private.genome_original_key_shape_v1(p_key text)
returns boolean language sql immutable set search_path = '' as $$
 select coalesce(p_key ~ '^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/){3}original-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(part|vcf|vcf\.gz|g\.vcf|txt|tsv))$',false);
$$;
revoke all on function private.genome_original_key_shape_v1(text)
 from public,anon,authenticated,inherit_upload_only,service_role;

create function private.subject_upload_object_key_v1(p_account uuid,p_subject uuid,p_upload uuid,p_format text,p_staging boolean)
returns text language sql volatile set search_path = '' as $$
 select p_account::text || '/' || p_subject::text || '/' || p_upload::text || '/original-' ||
 pg_catalog.gen_random_uuid()::text || case when p_staging then '.part'
  when p_format='VCF' then '.vcf' when p_format='VCF.GZ' then '.vcf.gz'
  when p_format='gVCF' then '.g.vcf' when p_format like 'consumer-array-text-v%' then '.txt' end;
$$;
revoke all on function private.subject_upload_object_key_v1(uuid,uuid,uuid,text,boolean)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- uuid::text preserves every existing final/retirement key's canonical bytes.
alter table public.upload_sessions alter column final_object_name type text using final_object_name::text;
alter table private.own_original_retirements alter column object_key type text using object_key::text;
alter table public.upload_sessions drop constraint upload_sessions_staging_object_name_check;
alter table public.upload_sessions add constraint upload_sessions_staging_object_name_check
 check(staging_object_name ~ '^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/){3}original-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(part|vcf|vcf\.gz|g\.vcf|txt|tsv))$');
alter table public.genome_storage_objects drop constraint genome_storage_objects_object_name_check;
alter table public.genome_storage_objects add constraint genome_storage_objects_object_name_check
 check(object_name ~ '^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/){3}original-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(part|vcf|vcf\.gz|g\.vcf|txt|tsv))$');
alter table public.other_adult_held_uploads drop constraint other_adult_held_uploads_object_name_check;
alter table public.other_adult_held_uploads add constraint other_adult_held_uploads_object_name_check
 check(object_name ~ '^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/){3}original-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(part|vcf|vcf\.gz|g\.vcf|txt|tsv))$');
alter table private.own_original_retirements add constraint own_original_retirements_object_key_shape
 check(object_key ~ '^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/){3}original-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(part|vcf|vcf\.gz|g\.vcf|txt|tsv))$');

-- A legacy row may keep its exact flat staging/final locators. New rows cannot
-- mint them; new final names on an old upload still use its existing row IDs.
create function private.guard_subject_upload_namespace_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare prefix text; expected_extension text;
begin
 if new.token_jti is null then return new; end if;
 prefix:=new.account_id::text || '/' || new.subject_id::text || '/' || new.id::text || '/';
 if new.subject_id is null or not private.genome_original_key_shape_v1(new.staging_object_name)
  or (position('/' in new.staging_object_name)>0 and
   (left(new.staging_object_name,length(prefix)) is distinct from prefix
    or new.staging_object_name !~ '\.part$'))
  or (position('/' in new.staging_object_name)=0 and (tg_op='INSERT'
   or new.staging_object_name is distinct from old.staging_object_name)) then
  raise exception using errcode='22023',message='upload_key_unavailable'; end if;
 expected_extension:=case when new.declared_format='VCF' then '.vcf'
  when new.declared_format='VCF.GZ' then '.vcf.gz' when new.declared_format='gVCF' then '.g.vcf'
  when new.declared_format like 'consumer-array-text-v%' then '.txt' end;
 if new.final_object_name is not null and (
  not private.genome_original_key_shape_v1(new.final_object_name)
  or (position('/' in new.final_object_name)>0 and (expected_extension is null
   or left(new.final_object_name,length(prefix)) is distinct from prefix
   or substring(new.final_object_name from length(prefix)+46) is distinct from expected_extension))
  or (position('/' in new.final_object_name)=0 and (tg_op='INSERT'
   or new.final_object_name is distinct from old.final_object_name))) then
  raise exception using errcode='22023',message='upload_key_unavailable'; end if;
 if tg_op='UPDATE' and (new.staging_object_name is distinct from old.staging_object_name
  or (old.final_object_name is not null and new.final_object_name is distinct from old.final_object_name)) then
  raise exception using errcode='22023',message='upload_key_immutable'; end if;
 return new;
end; $$;
revoke all on function private.guard_subject_upload_namespace_v1()
 from public,anon,authenticated,inherit_upload_only,service_role;
create trigger guard_subject_upload_namespace before insert or update on public.upload_sessions
 for each row execute function private.guard_subject_upload_namespace_v1();

create or replace function private.issue_own_storage_upload_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_declared_format text,p_size_bytes bigint,p_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c jsonb; u public.upload_sessions%rowtype; v_max bigint; v_not_after timestamptz; limits private.upload_authorization_config%rowtype; v_reserved numeric; v_upload uuid:=gen_random_uuid();
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
 insert into public.upload_sessions(id,account_id,auth_session_id,subject_id,staging_object_name,expected_size,
  expected_sha256,content_type,upload_revision,status,expires_at,storage_bucket,token_jti,declared_format,
  account_revision,account_auth_session_revision,originating_session_revision,jurisdiction_revision,
  subject_binding_revision,account_binding_revision,subject_lifecycle_revision,upload_consent_id,maximum_decoded_bytes)
 values(v_upload,p_account_id,p_session_id,p_subject_id,
  private.subject_upload_object_key_v1(p_account_id,p_subject_id,v_upload,p_declared_format,true),p_size_bytes,p_sha256,
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

create or replace function private.issue_other_adult_held_upload_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_declared_format text,p_size_bytes bigint,p_sha256 text,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c jsonb; u public.upload_sessions%rowtype; v_max bigint; v_not_after timestamptz;
 limits private.upload_authorization_config%rowtype; v_reserved numeric; v_upload uuid:=gen_random_uuid();
begin
 if p_test_jurisdiction is distinct from true then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_declared_format is null or p_declared_format not in
  ('consumer-array-text-v1','consumer-array-text-v2','consumer-array-text-v3','consumer-array-text-v4','VCF','VCF.GZ','gVCF')
  or p_size_bytes is null or p_size_bytes<=0 or p_sha256 is null or p_sha256!~'^[0-9a-f]{64}$' or p_subject_id is null then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select * into limits from private.upload_authorization_config where singleton for share;
 if limits.maximum_array_bytes is null or limits.maximum_vcf_bytes is null
  or limits.maximum_account_bytes is null or limits.maximum_active_uploads is null then
  raise exception using errcode='55000',message='upload_unavailable'; end if;
 c:=private.other_adult_upload_store_authority_v1(p_account_id,p_session_id,p_subject_id);
 if exists(select 1 from public.other_adult_held_uploads where subject_id=p_subject_id and state='pending') then
  raise exception using errcode='55000',message='upload_unavailable'; end if;
 v_max:=case when p_declared_format like 'consumer-array-text-v%' then limits.maximum_array_bytes
  when p_declared_format='gVCF' then coalesce(limits.maximum_gvcf_bytes,limits.maximum_vcf_bytes) else limits.maximum_vcf_bytes end;
 if p_size_bytes>v_max then raise exception using errcode='22023',message='file_too_large'; end if;
 select coalesce(sum(size_bytes),0) into v_reserved from public.genome_files where user_id=p_account_id;
 v_reserved:=v_reserved+(select coalesce(sum(expected_size),0) from public.upload_sessions
  where account_id=p_account_id and (status='held'
   or (status in ('issued','uploaded','validating') and expires_at>clock_timestamp())));
 if v_reserved+p_size_bytes>limits.maximum_account_bytes then
  raise exception using errcode='22023',message='file_too_large'; end if;
 if (select count(*) from public.upload_sessions where account_id=p_account_id
  and status in ('issued','uploaded','validating') and expires_at>clock_timestamp())>=limits.maximum_active_uploads then
  raise exception using errcode='55000',message='upload_unavailable'; end if;
 select not_after into v_not_after from auth.sessions where id=p_session_id and user_id=p_account_id;
 insert into public.upload_sessions(id,account_id,auth_session_id,subject_id,staging_object_name,expected_size,
  expected_sha256,content_type,upload_revision,status,expires_at,storage_bucket,token_jti,declared_format,
  account_revision,account_auth_session_revision,originating_session_revision,jurisdiction_revision,
  subject_binding_revision,account_binding_revision,subject_lifecycle_revision,upload_consent_id,maximum_decoded_bytes,
  upload_authority_kind)
 values(v_upload,p_account_id,p_session_id,p_subject_id,
  private.subject_upload_object_key_v1(p_account_id,p_subject_id,v_upload,p_declared_format,true),p_size_bytes,p_sha256,
  'application/octet-stream',1,'issued',least(clock_timestamp()+interval '30 minutes',v_not_after),
  'genomes',gen_random_uuid(),p_declared_format,(c->>'accountRevision')::bigint,
  (c->>'authSessionRevision')::bigint,(c->>'originatingSessionRevision')::bigint,
  (c->>'jurisdictionRevision')::bigint,(c->>'subjectBindingRevision')::bigint,
  (c->>'accountBindingRevision')::bigint,(c->>'subjectLifecycleRevision')::bigint,(c->>'uploadConsentId')::uuid,v_max,
  'other-adult-held')
 returning * into u;
 return jsonb_build_object('accountId',u.account_id,'sessionId',u.auth_session_id,
  'accountAuthSessionRevision',u.account_auth_session_revision,'uploadId',u.id,'jti',u.token_jti,
  'stagingKey',u.staging_object_name,'expiresAt',u.expires_at,'maximumBytes',u.expected_size);
end;
$function$;

create or replace function private.authorize_storage_upload_insert()
returns boolean language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare claims jsonb:=auth.jwt(); live jsonb; u public.upload_sessions%rowtype; c jsonb;
begin
 if claims->>'role' is distinct from 'inherit_upload_only'
  or claims->>'aud' is distinct from 'inherit-storage-upload'
  or coalesce(claims->>'jti','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(claims->>'upload_session_id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or not private.genome_original_key_shape_v1(claims->>'staging_key')
  or jsonb_typeof(claims->'iat') is distinct from 'number'
  or coalesce(claims->>'iat','')!~'^[0-9]+$'
  or jsonb_typeof(claims->'nbf') is distinct from 'number'
  or claims->'nbf' is distinct from claims->'iat'
  or (claims->>'iat')::numeric>extract(epoch from clock_timestamp())
  or (claims->>'exp')::numeric-(claims->>'iat')::numeric>1800
  or claims ? 'refresh_token' then return false; end if;
 live:=private.assert_live_authenticated_session();
 if live->>'authorized' is distinct from 'true' then return false; end if;
 select * into u from public.upload_sessions where id=(claims->>'upload_session_id')::uuid for share;
 if u.id is null or u.token_jti is distinct from (claims->>'jti')::uuid
  or u.account_id is distinct from (claims->>'sub')::uuid or u.auth_session_id is distinct from (claims->>'session_id')::uuid
  or u.token_jti=u.auth_session_id or u.storage_bucket<>'genomes' or u.status<>'issued' or u.consumed_at is not null
  or u.staging_object_name is distinct from claims->>'staging_key' or u.expires_at<=clock_timestamp()
  or claims->'maximum_bytes' is distinct from to_jsonb(u.expected_size)
  or (claims->>'exp')::numeric>extract(epoch from u.expires_at)
  or u.account_auth_session_revision is distinct from (live->>'account_auth_session_revision')::bigint
  or u.originating_session_revision is distinct from (live->>'session_revision')::bigint then return false; end if;
 -- 20260928150000: dispatched by the session's immutable authority kind.
 c:=private.subject_upload_store_authority_v1(u.upload_authority_kind,u.account_id,u.auth_session_id,u.subject_id);
 return c=jsonb_build_object('accountRevision',u.account_revision,'authSessionRevision',u.account_auth_session_revision,
  'jurisdictionRevision',u.jurisdiction_revision,'subjectBindingRevision',u.subject_binding_revision,
  'accountBindingRevision',u.account_binding_revision,'subjectLifecycleRevision',u.subject_lifecycle_revision,
  'originatingSessionRevision',u.originating_session_revision,'uploadConsentId',u.upload_consent_id);
exception when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation or numeric_value_out_of_range then
 return false;
end;
$function$;

create or replace function private.own_upload_finalization_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid,p_claim uuid,p_start boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u public.upload_sessions%rowtype; locked_u public.upload_sessions%rowtype; c jsonb;
begin
 select * into u from public.upload_sessions where id=p_upload_id;
 if u.id is null or u.account_id is distinct from p_account_id or u.auth_session_id is distinct from p_session_id
  or u.token_jti is null or u.maximum_decoded_bytes is null then
  raise exception using errcode='42501',message='not_found'; end if;
 -- 20260928150000: dispatched by the session's immutable authority kind.
 c:=private.subject_upload_store_authority_v1(u.upload_authority_kind,p_account_id,p_session_id,u.subject_id);
 select * into locked_u from public.upload_sessions where id=u.id for update;
 if to_jsonb(u) is distinct from to_jsonb(locked_u) or u.expires_at<=clock_timestamp()
  or c is distinct from jsonb_build_object('accountRevision',u.account_revision,'authSessionRevision',u.account_auth_session_revision,
   'jurisdictionRevision',u.jurisdiction_revision,'subjectBindingRevision',u.subject_binding_revision,
   'accountBindingRevision',u.account_binding_revision,'subjectLifecycleRevision',u.subject_lifecycle_revision,
   'originatingSessionRevision',u.originating_session_revision,'uploadConsentId',u.upload_consent_id) then
  raise exception using errcode='42501',message='not_found'; end if;
 -- V2 owns an independent attempt lease even before the first checkpoint.
 -- Legacy callers cannot enter it; every existing read/write/complete RPC
 -- still passes here, so rotating the claim fences all previous holders.
 if exists(select 1 from private.own_upload_finalization_attempts where upload_id=u.id) then
  if p_start and u.status<>'promoted' then
   raise exception using errcode='55000',message='upload_unavailable';
  elsif not p_start and not exists(select 1 from private.own_upload_finalization_attempts a
   where a.upload_id=u.id and a.claim=p_claim and a.lease_expires_at>clock_timestamp()) then
   raise exception using errcode='42501',message='not_found';
  end if;
 end if;
 if p_start then
  if u.status='promoted' and u.finalized_file_id is not null then
   return jsonb_build_object('status','complete','fileId',u.finalized_file_id); end if;
  -- 20260928150000: a held revision is finished; it waits for its subject.
  if u.status='held' then return jsonb_build_object('status','held','fileId',(select h.id from public.other_adult_held_uploads h where h.upload_session_id=u.id)); end if;
  if u.status='validating' then
   -- Resume this session's own finalization, or refuse. The lapsed lease is
   -- the only evidence that the previous holder is gone; a live one means it
   -- is still working and a second request must not join it.
   if not exists(select 1 from private.own_upload_finalization_checkpoints k
    where k.upload_id=u.id and k.finalization_claim=u.finalization_claim
     and k.lease_expires_at<=clock_timestamp()) then
    raise exception using errcode='55000',message='upload_unavailable'; end if;
  elsif u.status<>'uploaded' then
   raise exception using errcode='55000',message='upload_unavailable';
  else
   update public.upload_sessions set status='validating',finalization_claim=gen_random_uuid(),
    final_object_name=private.subject_upload_object_key_v1(u.account_id,u.subject_id,u.id,u.declared_format,false),finalization_started_at=clock_timestamp()
    where id=u.id returning * into u;
  end if;
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

create or replace function private.begin_own_upload_finalization_v2(p_account_id uuid,p_session_id uuid,p_upload_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u public.upload_sessions%rowtype; locked_u public.upload_sessions%rowtype; c jsonb; a private.own_upload_finalization_attempts%rowtype;
 k private.own_upload_finalization_checkpoints%rowtype; previous_claim uuid; stamp timestamptz;
begin
 select * into u from public.upload_sessions where id=p_upload_id;
 if u.id is null or u.account_id is distinct from p_account_id or u.auth_session_id is distinct from p_session_id
  or u.token_jti is null or u.maximum_decoded_bytes is null then
  raise exception using errcode='42501',message='not_found'; end if;
 -- 20260928150000: dispatched by the session's immutable authority kind.
 c:=private.subject_upload_store_authority_v1(u.upload_authority_kind,p_account_id,p_session_id,u.subject_id);
 select * into locked_u from public.upload_sessions where id=u.id for update;
 if to_jsonb(u) is distinct from to_jsonb(locked_u) or u.expires_at<=clock_timestamp()
  or c is distinct from jsonb_build_object('accountRevision',u.account_revision,'authSessionRevision',u.account_auth_session_revision,
   'jurisdictionRevision',u.jurisdiction_revision,'subjectBindingRevision',u.subject_binding_revision,
   'accountBindingRevision',u.account_binding_revision,'subjectLifecycleRevision',u.subject_lifecycle_revision,
   'originatingSessionRevision',u.originating_session_revision,'uploadConsentId',u.upload_consent_id) then
  raise exception using errcode='42501',message='not_found'; end if;
 if u.status='promoted' and u.finalized_file_id is not null then
  return jsonb_build_object('status','complete','fileId',u.finalized_file_id); end if;
 -- 20260928150000: a held revision is finished; it waits for its subject.
 if u.status='held' then return jsonb_build_object('status','held','fileId',(select h.id from public.other_adult_held_uploads h where h.upload_session_id=u.id)); end if;
 select * into a from private.own_upload_finalization_attempts where upload_id=u.id for update;
 select * into k from private.own_upload_finalization_checkpoints where upload_id=u.id for update;
 stamp:=clock_timestamp();
 if u.status='validating' then
  if a.upload_id is not null then
   if a.claim is distinct from u.finalization_claim or a.lease_expires_at>stamp then
    raise exception using errcode='55000',message='upload_unavailable'; end if;
  else
   -- A request started by the old deployment has no attempt lease. Drain its
   -- existing 300-second invocation window after its latest known activity.
   -- Missing validation progress may restart only once that window has passed.
   if u.finalization_started_at is null or
    greatest(u.finalization_started_at,coalesce(k.updated_at,u.finalization_started_at))+interval '300 seconds'>stamp then
    raise exception using errcode='55000',message='upload_unavailable'; end if;
  end if;
  if k.upload_id is not null and k.finalization_claim is distinct from u.finalization_claim then
   raise exception using errcode='42501',message='not_found'; end if;
 elsif u.status<>'uploaded' or a.upload_id is not null or k.upload_id is not null then
  raise exception using errcode='55000',message='upload_unavailable';
 end if;
 previous_claim:=u.finalization_claim;
 update public.upload_sessions set status='validating',finalization_claim=gen_random_uuid(),
  final_object_name=coalesce(final_object_name,private.subject_upload_object_key_v1(u.account_id,u.subject_id,u.id,u.declared_format,false)),finalization_started_at=stamp
  where id=u.id returning * into u;
 insert into private.own_upload_finalization_attempts(upload_id,claim,lease_expires_at)
  values(u.id,u.finalization_claim,least(stamp+interval '60 seconds',u.expires_at))
  on conflict(upload_id) do update set claim=excluded.claim,lease_expires_at=excluded.lease_expires_at;
 -- Transfer only the exact prior claim's immutable evidence. Revision and byte
 -- offset do not reset, so any stale writer fails both ownership and CAS.
 update private.own_upload_finalization_checkpoints set finalization_claim=u.finalization_claim,
  lease_expires_at=least(stamp+interval '60 seconds',u.expires_at)
  where upload_id=u.id and finalization_claim=previous_claim;
 return jsonb_build_object('status','authorized','uploadId',u.id,'claim',u.finalization_claim,
  'bucket','genomes','stagingKey',u.staging_object_name,'finalKey',u.final_object_name,
  'expectedSize',u.expected_size,'expectedSha256',u.expected_sha256,'declaredFormat',u.declared_format,
  'maximumDecodedBytes',u.maximum_decoded_bytes);
exception when insufficient_privilege or object_not_in_prerequisite_state then
 raise exception using errcode='42501',message='not_found';
end;
$function$;

create or replace function private.own_upload_normalization_v1(p_operation text,p_account_id uuid,p_session_id uuid,
 p_file_id uuid,p_claim uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare f public.genome_files%rowtype; c jsonb; m jsonb; r private.own_normalization_runs%rowtype;
 v_max bigint; v_variant_count bigint; v_observed_count bigint; v_finished timestamptz;
 v_authority_deadline timestamptz;
begin
 if p_operation is null or p_operation not in ('begin','check','stage','complete','fail','reject-build','check-rejected','finish-rejected') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select * into f from public.genome_files where id=p_file_id;
 if f.id is null or f.user_id is distinct from p_account_id or f.tier<>1
  or f.subject_id is null or f.single_logical_sample_verified_at is null
  or f.structural_validator_version<>'single-logical-sample-v1' then
  raise exception using errcode='42501',message='not_found'; end if;
 -- A rejected-build object is an exact frozen cleanup target, not a new data
 -- read. Its original worker can finish cleanup even after consent revocation.
 if p_operation in ('check-rejected','finish-rejected') or (p_operation='begin' and exists(
  select 1 from private.own_normalization_runs where file_id=f.id and state in ('rejecting','rejected'))) then
  perform 1 from public.genome_files where id=f.id for update;
  select * into r from private.own_normalization_runs where file_id=f.id for update;
  if r.account_id is distinct from p_account_id or r.state not in ('rejecting','rejected')
   or (p_operation<>'begin' and (p_claim is null or r.claim is distinct from p_claim))
   or not exists(select 1 from auth.sessions where id=p_session_id and user_id=p_account_id
    and (not_after is null or not_after>clock_timestamp())) then
   raise exception using errcode='42501',message='not_found'; end if;
  if p_operation='finish-rejected' then
   if exists(select 1 from storage.objects where id=f.storage_object_id or (bucket_id='genomes' and name=f.bucket_path)) then
    raise exception using errcode='55000',message='cleanup_incomplete'; end if;
   update public.genome_storage_objects set state='purged' where genome_file_id=f.id and object_id=f.storage_object_id;
   update private.own_normalization_runs set state='rejected' where file_id=f.id;
   return 'true'::jsonb;
  end if;
  return jsonb_build_object('status','build_cleanup_required','fileId',f.id,'claim',r.claim,
   'bucket','genomes','objectKey',f.bucket_path,'objectId',f.storage_object_id);
 end if;
 -- Cleanup cannot publish anything and is deliberately allowed after revocation.
 if p_operation='fail' then
  perform 1 from public.genome_files where id=f.id for update;
  select * into r from private.own_normalization_runs where file_id=f.id for update;
  if p_claim is null or r.claim is distinct from p_claim or r.account_id is distinct from p_account_id
   or r.session_id is distinct from p_session_id or r.state<>'running' then
   raise exception using errcode='42501',message='not_found'; end if;
  delete from private.own_normalization_batches where file_id=f.id;
  update private.own_normalization_runs set state='failed' where file_id=f.id;
  update public.genome_files set status='failed',error='File preparation did not complete. Please try again.'
   where id=f.id and processing_run_id=p_claim and normalization_completed_at is null;
  return 'true'::jsonb;
 end if;
 c:=private.own_upload_store_authority_v1(p_account_id,p_session_id,f.subject_id);
 -- Lock order follows the store-authority account/subject locks, then the file.
 perform 1 from public.genome_files where id=f.id and user_id=f.user_id and subject_id=f.subject_id
  and upload_revision=f.upload_revision and bucket_path=f.bucket_path and storage_object_id=f.storage_object_id
  and sha256=f.sha256 and source_sha256=f.source_sha256 for update;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select * into f from public.genome_files where id=f.id;
 if not exists(select 1 from public.genome_storage_objects g join storage.objects o on o.id=g.object_id
  where g.genome_file_id=f.id and g.object_id=f.storage_object_id and g.bucket_id='genomes'
   and g.object_name=f.bucket_path and g.sha256=f.sha256 and g.byte_count=f.size_bytes
   and g.object_revision=f.upload_revision and g.state='current' and g.revoked_at is null
   and o.bucket_id=g.bucket_id and o.name=g.object_name and (o.metadata->>'size')::numeric=f.size_bytes)
  or not private.genome_original_key_shape_v1(f.bucket_path) then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into r from private.own_normalization_runs where file_id=f.id for update;
 if p_operation='begin' then
  if p_payload is not null or p_claim is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  if f.normalization_completed_at is not null and f.normalization_source_revision=f.upload_revision and r.state='complete' then
   return jsonb_build_object('fileId',f.id,'status','normalization_complete','analysisState','not_generated'); end if;
  if f.status not in ('uploaded','stored','failed','parsing') or (r.state='running' and r.expires_at>clock_timestamp()) then
   raise exception using errcode='55000',message='normalization_in_progress'; end if;
  select case when f.file_type::text like 'array_%' then maximum_array_bytes
   when f.file_type::text='gvcf' then coalesce(maximum_gvcf_bytes,maximum_vcf_bytes) else maximum_vcf_bytes end
   into v_max from private.upload_authorization_config where singleton for share;
  if v_max is null or f.size_bytes>v_max then raise exception using errcode='55000',message='unavailable'; end if;
  p_claim:=gen_random_uuid();
  m:=jsonb_build_object('status','authorized','fileId',f.id,'claim',p_claim,'subjectId',f.subject_id,
   'bucket','genomes','objectKey',f.bucket_path,'objectId',f.storage_object_id,'sizeBytes',f.size_bytes,
   'rawSha256',f.sha256,'decodedSha256',f.source_sha256,'fileType',f.file_type,
   'sourceRevision',f.upload_revision,'maximumDecodedBytes',v_max);
  delete from private.own_normalization_batches where file_id=f.id;
  insert into private.own_normalization_runs(file_id,claim,account_id,session_id,authority,manifest,expires_at,state)
   values(f.id,p_claim,p_account_id,p_session_id,c,m,clock_timestamp()+interval '5 minutes','running')
   on conflict(file_id) do update set claim=excluded.claim,account_id=excluded.account_id,session_id=excluded.session_id,
    authority=excluded.authority,manifest=excluded.manifest,expires_at=excluded.expires_at,state='running',provenance=null;
  update public.genome_files set status='parsing',processing_run_id=p_claim,processing_started_at=clock_timestamp(),
   processing_finished_at=null,error=null where id=f.id;
  return m;
 end if;
 if p_claim is null or r.claim is distinct from p_claim or r.account_id is distinct from p_account_id
  or r.session_id is distinct from p_session_id or r.state<>'running' or r.expires_at<=clock_timestamp()
  or r.authority is distinct from c or f.processing_run_id is distinct from p_claim or f.status<>'parsing'
  or r.manifest->>'rawSha256' is distinct from f.sha256 or r.manifest->>'decodedSha256' is distinct from f.source_sha256
  or (r.manifest->>'sourceRevision')::bigint is distinct from f.upload_revision then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='check' then
  if p_payload is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  return r.manifest;
 elsif p_operation='reject-build' then
  if p_payload is not null or exists(select 1 from private.own_normalization_batches where file_id=f.id)
   or exists(select 1 from public.user_variants where file_id=f.id)
   or exists(select 1 from public.report_observed_calls where file_id=f.id)
   or f.normalization_completed_at is not null then
   raise exception using errcode='42501',message='not_found'; end if;
  update public.genome_files set status='failed',build='unknown',error='build_unknown' where id=f.id;
  update public.genome_storage_objects set state='purge_queued',revoked_at=clock_timestamp()
   where genome_file_id=f.id and object_id=f.storage_object_id;
  update private.own_normalization_runs set state='rejecting' where file_id=f.id;
  return jsonb_build_object('status','build_cleanup_required','fileId',f.id,'claim',r.claim,
   'bucket','genomes','objectKey',f.bucket_path,'objectId',f.storage_object_id);
 elsif p_operation='stage' then
  if jsonb_typeof(p_payload) is distinct from 'object' or not (p_payload ?& array['kind','sequence','rows'])
   or p_payload-array['kind','sequence','rows']<>'{}'::jsonb
   or p_payload->>'kind' not in ('variants','observed') or jsonb_typeof(p_payload->'rows') is distinct from 'array'
   or jsonb_array_length(p_payload->'rows') not between 1 and 1000
   or p_payload->>'sequence'!~'^(0|[1-9][0-9]*)$' or octet_length(p_payload::text)>4000000 then
   raise exception using errcode='22023',message='invalid_request'; end if;
  -- Strictly ordered batches prevent a dropped/duplicated request from being
  -- interpreted as a complete source. No caller can supply ownership columns.
  if (p_payload->>'sequence')::integer<>(select count(*) from private.own_normalization_batches
   where file_id=f.id and kind=p_payload->>'kind') then
   raise exception using errcode='22023',message='invalid_request'; end if;
  insert into private.own_normalization_batches(file_id,kind,sequence,rows)
   values(f.id,p_payload->>'kind',(p_payload->>'sequence')::integer,p_payload->'rows');
  return 'true'::jsonb;
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object'
  or not (p_payload ?& array['sourceBuild','rawSha256','decodedSha256','variantCount','observedCallCount','provenance'])
  or p_payload-array['sourceBuild','rawSha256','decodedSha256','variantCount','observedCallCount','provenance']<>'{}'::jsonb
  or p_payload->>'sourceBuild' not in ('GRCh37','GRCh38')
  or p_payload->>'rawSha256' is distinct from f.sha256 or p_payload->>'decodedSha256' is distinct from f.source_sha256
  or jsonb_typeof(p_payload->'provenance') is distinct from 'object' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select coalesce(sum(jsonb_array_length(rows)) filter(where kind='variants'),0),
  coalesce(sum(jsonb_array_length(rows)) filter(where kind='observed'),0)
  into v_variant_count,v_observed_count from private.own_normalization_batches where file_id=f.id;
 if v_variant_count+v_observed_count=0 or (p_payload->>'variantCount')::bigint is distinct from v_variant_count
  or (p_payload->>'observedCallCount')::bigint is distinct from v_observed_count then
  raise exception using errcode='22023',message='invalid_request'; end if;
 delete from public.user_variants where file_id=f.id;
 delete from public.report_observed_calls where file_id=f.id;
 insert into public.user_variants(file_id,user_id,subject_id,rsid,chrom,pos,ref,alt,genotype)
 select f.id,f.user_id,f.subject_id,x.rsid,x.chrom,x.pos,x.ref,x.alt,x.genotype
 from private.own_normalization_batches b cross join lateral jsonb_to_recordset(b.rows)
  as x(rsid bigint,chrom smallint,pos integer,ref text,alt text,genotype text)
 where b.file_id=f.id and b.kind='variants';
 insert into public.report_observed_calls(file_id,user_id,subject_id,source_line,source_sha256,extraction_version,
  source_build,source_chrom,source_pos,source_ref,source_alt,source_gt,rsid,chrom,pos,ref,alt,genotype,
  site_filter,sample_filter,genotype_quality,read_depth,quality_state,usable)
 select f.id,f.user_id,f.subject_id,x.source_line,f.sha256,'vcf-literal-diploid-snp-v1',
  p_payload->>'sourceBuild',x.source_chrom,x.source_pos,x.source_ref,x.source_alt,x.source_gt,x.rsid,x.chrom,x.pos,
  x.ref,x.alt,x.genotype,x.site_filter,x.sample_filter,x.genotype_quality,x.read_depth,x.quality_state,x.usable
 from private.own_normalization_batches b cross join lateral jsonb_to_recordset(b.rows)
  as x(source_line bigint,source_chrom smallint,source_pos bigint,source_ref text,source_alt text,source_gt text,
   rsid bigint,chrom smallint,pos bigint,ref text,alt text,genotype text,site_filter text,sample_filter text,
   genotype_quality numeric,read_depth numeric,quality_state text,usable boolean)
 where b.file_id=f.id and b.kind='observed';
 -- Bulk writes can outlast time-bound permission even while rows are locked.
 -- Reauthorize the same actor/session/source/store grant after all inserts.
 m:=private.own_upload_store_authority_v1(p_account_id,p_session_id,f.subject_id);
 if m is distinct from c or m is distinct from r.authority then
  raise exception using errcode='42501',message='not_found'; end if;
 select least(r.expires_at,a.not_after,sc.expires_at) into v_authority_deadline
 from auth.sessions a join public.subject_consents sc
  on sc.id=(r.authority->>'uploadConsentId')::uuid
 where a.id=p_session_id and a.user_id=p_account_id
  and sc.subject_id=f.subject_id and sc.account_id=p_account_id;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 -- Take the publication clock only after the final authority/deadline reads.
 v_finished:=clock_timestamp();
 if v_authority_deadline is null or v_finished>=v_authority_deadline then
  raise exception using errcode='42501',message='not_found'; end if;
 update public.genome_files set status='stored',build=p_payload->>'sourceBuild',variant_count=v_variant_count,
  processing_finished_at=v_finished,normalization_completed_at=v_finished,normalization_source_revision=upload_revision
  where id=f.id;
 update private.own_normalization_runs set state='complete',provenance=p_payload->'provenance' where file_id=f.id;
 delete from private.own_normalization_batches where file_id=f.id;
 -- Include terminal metadata/batch cleanup in the same finite publication.
 if clock_timestamp()>=v_authority_deadline then
  raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('fileId',f.id,'status','normalization_complete','analysisState','not_generated');
end;
$function$;

create or replace function private.track_own_original_retirement_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; object_version text;
begin
 if not exists(select 1 from private.own_original_retention_config where singleton and enabled) then return new;end if;
 select * into strict f from public.genome_files where id=new.file_id;
 if f.created_at<(select applies_after from private.own_original_retention_config where singleton) then return new;end if;
 select version into object_version from storage.objects where id=f.storage_object_id and bucket_id='genomes'
 and name=f.bucket_path and (metadata->>'size')::numeric=f.size_bytes for share;
 if object_version is null or object_version!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 or f.created_at+interval '1 month'<=clock_timestamp() then raise exception using errcode='55000',message='original_retention_unavailable';end if;
 insert into private.own_original_retirements(file_id,manifest_id,account_id,source,object_id,object_key,storage_version,byte_count,sha256,created_at,expires_at)
 values(f.id,new.id,f.user_id,new.source,f.storage_object_id,f.bucket_path,object_version::uuid,f.size_bytes,f.sha256,f.created_at,f.created_at+interval '1 month');
 return new;
end; $$;

-- CREATE OR REPLACE preserves all existing owners, function settings and grants.
