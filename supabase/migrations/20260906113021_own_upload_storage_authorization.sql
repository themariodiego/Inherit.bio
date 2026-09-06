-- Operator-approved ADR 0023: a claims-only boolean predicate, not table access.
create role inherit_upload_only nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant inherit_upload_only to authenticator;
grant usage on schema storage,private to inherit_upload_only;
grant insert on storage.objects to inherit_upload_only;
revoke all on all tables in schema public from inherit_upload_only;

create table private.upload_authorization_config (
 singleton boolean primary key default true check(singleton),
 auth_issuer text not null check(auth_issuer ~ '^https?://[^/?#]+/auth/v1$')
);
alter table private.upload_authorization_config enable row level security;
revoke all on private.upload_authorization_config from public,anon,authenticated,inherit_upload_only;
grant all on private.upload_authorization_config to service_role;
-- Intentionally no inferred issuer or production key. Rollout configures this.

alter table public.upload_sessions
 add column storage_bucket text not null default 'genomes-staging' check(storage_bucket in ('genomes','genomes-staging')),
 add column token_jti uuid unique,
 add column declared_format text,
 add column account_revision bigint,
 add column account_auth_session_revision bigint,
 add column originating_session_revision bigint,
 add column jurisdiction_revision bigint,
 add column subject_binding_revision bigint,
 add column account_binding_revision bigint,
 add column subject_lifecycle_revision bigint,
 add column upload_consent_id uuid references public.subject_consents(id) on delete restrict;
alter table public.upload_sessions alter column expected_sha256 drop not null;
alter table public.upload_sessions add constraint upload_sessions_token_snapshot_check check(
 token_jti is null or (
  storage_bucket='genomes' and subject_id is not null and cohort_id is null
  and declared_format is not null
  and declared_format in ('consumer-array-text-v1','consumer-array-text-v2','consumer-array-text-v3','consumer-array-text-v4','VCF','VCF.GZ','gVCF')
  and account_revision is not null and account_revision>0
  and account_auth_session_revision is not null and account_auth_session_revision>0
  and originating_session_revision is not null and originating_session_revision>0
  and jurisdiction_revision is not null and jurisdiction_revision>0
  and subject_binding_revision is not null and subject_binding_revision>0
  and account_binding_revision is not null and account_binding_revision>0
  and subject_lifecycle_revision is not null and subject_lifecycle_revision>0
  and upload_consent_id is not null and token_jti<>auth_session_id
 ));

create function private.assert_live_authenticated_session()
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c jsonb:=auth.jwt(); a uuid; s uuid; p public.profiles%rowtype; v_session bigint; v_issuer text;
begin
 select auth_issuer into v_issuer from private.upload_authorization_config where singleton for share;
 if v_issuer is null or c->>'iss' is distinct from v_issuer
  or (coalesce(c->>'role',''),coalesce(c->>'aud','')) not in (('authenticated','authenticated'),('inherit_upload_only','inherit-storage-upload'))
  or coalesce(c->>'sub','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(c->>'session_id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(c->'exp') is distinct from 'number' or coalesce(c->>'exp','')!~'^[0-9]+$'
  or (c->>'exp')::numeric<=extract(epoch from clock_timestamp()) then
  return '{"authorized":false}'::jsonb;
 end if;
 a:=(c->>'sub')::uuid; s:=(c->>'session_id')::uuid;
 perform 1 from auth.users where id=a and deleted_at is null
  and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then return '{"authorized":false}'::jsonb; end if;
 select coalesce(refresh_token_counter,0)+1 into v_session from auth.sessions
  where id=s and user_id=a and (not_after is null or not_after>clock_timestamp()) for share;
 if v_session is null then return '{"authorized":false}'::jsonb; end if;
 select * into p from public.profiles where id=a for update;
 if p.id is null or p.deletion_requested_at is not null then return '{"authorized":false}'::jsonb; end if;
 if c->>'role'='inherit_upload_only' and (c->'account_auth_session_revision') is distinct from to_jsonb(p.auth_session_revision) then
  return '{"authorized":false}'::jsonb;
 end if;
 return jsonb_build_object('authorized',true,'account_auth_session_revision',p.auth_session_revision,'session_revision',v_session);
exception when invalid_text_representation or numeric_value_out_of_range then
 return '{"authorized":false}'::jsonb;
end;
$function$;
revoke all on function private.assert_live_authenticated_session() from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.assert_live_authenticated_session() to authenticated,inherit_upload_only,service_role;

create function private.own_upload_store_authority_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c jsonb; v_consent uuid; v_principal uuid; v_lifecycle bigint; v_session bigint;
begin
 c:=private.own_upload_context_v1(p_account_id,p_session_id,p_subject_id);
 perform 1 from auth.users where id=p_account_id and (banned_until is null or banned_until<=clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 if c->>'birthDateState'<>'adult' then raise exception using errcode='55000',message='adult_account_required'; end if;
 select lifecycle_revision into v_lifecycle from public.subjects where id=p_subject_id for share;
 select coalesce(refresh_token_counter,0)+1 into v_session from auth.sessions where id=p_session_id and user_id=p_account_id for share;
 select subject_principal_id into v_principal from public.subject_account_bindings
  where subject_id=p_subject_id and account_id=p_account_id and status='current'
  and binding_revision=(c->>'accountBindingRevision')::bigint for share;
 -- Both artifacts must still be current, hash-verified and signed at this binding.
 perform 1 from public.consent_signatures cs join public.consent_artifacts ca
  on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
  and ca.body_sha256=cs.artifact_body_sha256
 where cs.target_kind='subject' and cs.target_id=p_subject_id and cs.signer_account_id=p_account_id
  and cs.signer_principal_id=v_principal and cs.subject_binding_revision=(c->>'subjectBindingRevision')::bigint
  and cs.jurisdiction_revision=(c->>'jurisdictionRevision')::bigint
  and ca.artifact_key='disclosure.insurance-and-discrimination' and ca.superseded_at is null
  and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 for share of cs,ca;
 if not found then raise exception using errcode='55000',message='insurance_acknowledgement_required'; end if;
 select sc.id into v_consent from public.subject_consents sc
 join public.consent_signatures cs on cs.id=sc.signature_id
 join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
  and ca.body_sha256=cs.artifact_body_sha256
 where sc.subject_id=p_subject_id and sc.account_id=p_account_id and sc.consent_type='upload_class'
  and sc.scope=array['store'] and sc.revoked_at is null and (sc.expires_at is null or sc.expires_at>clock_timestamp())
  and cs.target_kind='subject' and cs.target_id=p_subject_id and cs.signer_account_id=p_account_id
  and cs.signer_principal_id=v_principal and cs.subject_binding_revision=(c->>'subjectBindingRevision')::bigint
  and cs.jurisdiction_revision=(c->>'jurisdictionRevision')::bigint
  and ca.artifact_key='consent.upload-self' and ca.superseded_at is null
  and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 for share of sc,cs,ca;
 if v_consent is null then raise exception using errcode='55000',message='upload_consent_required'; end if;
 return (c-'birthDateState')||jsonb_build_object('uploadConsentId',v_consent,
  'subjectLifecycleRevision',v_lifecycle,'originatingSessionRevision',v_session);
end;
$function$;
revoke all on function private.own_upload_store_authority_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_upload_store_authority_v1(uuid,uuid,uuid) to service_role;

create function private.issue_own_storage_upload_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_declared_format text,p_size_bytes bigint,p_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c jsonb; u public.upload_sessions%rowtype; v_max bigint; v_not_after timestamptz;
begin
 if p_declared_format is null or p_declared_format not in
  ('consumer-array-text-v1','consumer-array-text-v2','consumer-array-text-v3','consumer-array-text-v4','VCF','VCF.GZ','gVCF')
  or p_size_bytes is null or p_size_bytes<=0 or (p_sha256 is not null and p_sha256!~'^[0-9a-f]{64}$') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 v_max:=case when p_declared_format like 'consumer-array-text-v%' then 104857600 else 209715200 end;
 if p_size_bytes>v_max then raise exception using errcode='22023',message='file_too_large'; end if;
 perform 1 from private.upload_authorization_config where singleton for share;
 if not found then raise exception using errcode='55000',message='upload_unavailable'; end if;
 c:=private.own_upload_store_authority_v1(p_account_id,p_session_id,p_subject_id);
 select not_after into v_not_after from auth.sessions where id=p_session_id and user_id=p_account_id;
 insert into public.upload_sessions(account_id,auth_session_id,subject_id,staging_object_name,expected_size,
  expected_sha256,content_type,upload_revision,status,expires_at,storage_bucket,token_jti,declared_format,
  account_revision,account_auth_session_revision,originating_session_revision,jurisdiction_revision,
  subject_binding_revision,account_binding_revision,subject_lifecycle_revision,upload_consent_id)
 values(p_account_id,p_session_id,p_subject_id,gen_random_uuid()::text,p_size_bytes,p_sha256,
  'application/octet-stream',1,'issued',least(clock_timestamp()+interval '30 minutes',v_not_after),
  'genomes',gen_random_uuid(),p_declared_format,(c->>'accountRevision')::bigint,
  (c->>'authSessionRevision')::bigint,(c->>'originatingSessionRevision')::bigint,
  (c->>'jurisdictionRevision')::bigint,(c->>'subjectBindingRevision')::bigint,
  (c->>'accountBindingRevision')::bigint,(c->>'subjectLifecycleRevision')::bigint,(c->>'uploadConsentId')::uuid)
 returning * into u;
 return jsonb_build_object('accountId',u.account_id,'sessionId',u.auth_session_id,
  'accountAuthSessionRevision',u.account_auth_session_revision,'uploadId',u.id,'jti',u.token_jti,
  'stagingKey',u.staging_object_name,'expiresAt',u.expires_at,'maximumBytes',u.expected_size);
end;
$function$;
revoke all on function private.issue_own_storage_upload_v1(uuid,uuid,uuid,text,bigint,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.issue_own_storage_upload_v1(uuid,uuid,uuid,text,bigint,text) to service_role;
create function public.issue_own_storage_upload_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_declared_format text,p_size_bytes bigint,p_sha256 text)
returns jsonb language sql security invoker set search_path=pg_catalog
as $function$ select private.issue_own_storage_upload_v1(p_account_id,p_session_id,p_subject_id,p_declared_format,p_size_bytes,p_sha256); $function$;
revoke all on function public.issue_own_storage_upload_v1(uuid,uuid,uuid,text,bigint,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.issue_own_storage_upload_v1(uuid,uuid,uuid,text,bigint,text) to service_role;

create function private.authorize_storage_upload_insert()
returns boolean language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare claims jsonb:=auth.jwt(); live jsonb; u public.upload_sessions%rowtype; c jsonb;
begin
 if claims->>'role' is distinct from 'inherit_upload_only'
  or claims->>'aud' is distinct from 'inherit-storage-upload'
  or coalesce(claims->>'jti','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(claims->>'upload_session_id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(claims->>'staging_key','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
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
 c:=private.own_upload_store_authority_v1(u.account_id,u.auth_session_id,u.subject_id);
 return c=jsonb_build_object('accountRevision',u.account_revision,'authSessionRevision',u.account_auth_session_revision,
  'jurisdictionRevision',u.jurisdiction_revision,'subjectBindingRevision',u.subject_binding_revision,
  'accountBindingRevision',u.account_binding_revision,'subjectLifecycleRevision',u.subject_lifecycle_revision,
  'originatingSessionRevision',u.originating_session_revision,'uploadConsentId',u.upload_consent_id);
exception when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation or numeric_value_out_of_range then
 return false;
end;
$function$;
revoke all on function private.authorize_storage_upload_insert() from public,anon,authenticated;
grant execute on function private.authorize_storage_upload_insert() to inherit_upload_only,service_role;

create policy genomes_upload_token_create_only on storage.objects for insert to inherit_upload_only
with check(
 bucket_id='genomes'
 and name=(current_setting('request.jwt.claims',true)::jsonb->>'staging_key')
 and case when jsonb_typeof(metadata->'size')='number'
  then (metadata->>'size')::numeric>0
   and (metadata->>'size')::numeric<=(current_setting('request.jwt.claims',true)::jsonb->>'maximum_bytes')::numeric
  else false end
 and private.authorize_storage_upload_insert()
);

-- A successful Storage INSERT consumes only this bearer. The trigger runs in
-- the same transaction, including Storage's rollback-only permission probe.
create function private.consume_storage_upload_insert()
returns trigger language plpgsql security definer set search_path=pg_catalog,private
as $function$
begin
 if auth.jwt()->>'role'='inherit_upload_only' then
  update public.upload_sessions set status='uploaded'
   where id=(auth.jwt()->>'upload_session_id')::uuid and token_jti=(auth.jwt()->>'jti')::uuid
    and storage_bucket=new.bucket_id and staging_object_name=new.name and status='issued' and consumed_at is null;
  if not found then raise exception using errcode='42501',message='upload_unavailable'; end if;
 end if;
 return new;
end;
$function$;
revoke all on function private.consume_storage_upload_insert() from public,anon,authenticated,inherit_upload_only;
grant execute on function private.consume_storage_upload_insert() to service_role;
create trigger inherit_consume_storage_upload after insert on storage.objects
 for each row execute function private.consume_storage_upload_insert();
