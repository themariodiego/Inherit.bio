-- Own-account upload consent. No historical authorizations are rewritten.
alter table public.profiles add column date_of_birth date;
-- Existing table-level profile grants must not make a new age declaration client-writable.
create function private.guard_profile_birth_date_v1()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $function$
begin
  if current_user in ('anon','authenticated') and (
    (TG_OP='INSERT' and new.date_of_birth is not null)
    or (TG_OP='UPDATE' and new.date_of_birth is distinct from old.date_of_birth)
  ) then raise exception using errcode='42501', message='birth_date_server_only'; end if;
  return new;
end;
$function$;
revoke all on function private.guard_profile_birth_date_v1() from public, anon, authenticated;
create trigger profiles_birth_date_server_only before insert or update on public.profiles
  for each row execute function private.guard_profile_birth_date_v1();
alter table public.account_operation_nonces drop constraint account_operation_nonces_operation_check;
alter table public.account_operation_nonces add constraint account_operation_nonces_operation_check
  check (operation in ('account_delete','account_delete_cancel','own_upload_artifact_sign'));
alter table public.subject_consents drop constraint subject_consents_consent_type_check;
alter table public.subject_consents add constraint subject_consents_consent_type_check
  check (consent_type in ('self_source','adult_source','embryo_source','cloud_model',
    'family_portrait','raw_export','future_person','donor_attribution','upload_class'));

insert into public.consent_artifacts
  (artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on)
values ('consent.upload-self',1,'9d993aa93c9a49fd7ebbc80f96d9416c19065176d6c05ac84c25aa4cbd11a525',
$artifact$You let Inherit store your genome file and prepare it for the uses you choose.

This permission is for your own DNA. It does not let you upload another person's DNA.

It does not turn on any analysis, sharing, research or outside AI service. Those choices are separate and start off.

You can withdraw this permission and ask to delete your file. You can still ask for a free copy of your data.

What you confirm:

1. I am 18 or older and this is my own DNA.$artifact$,
'Let Inherit store and prepare your own DNA file. You choose separately which results to make and whether to share them. You can withdraw this permission.',
date '2026-09-06');

create function private.sign_own_upload_artifact_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid,
  p_artifact_key text, p_artifact_version integer, p_artifact_body_sha256 text,
  p_statement_keys text[], p_account_revision bigint, p_auth_session_revision bigint,
  p_jurisdiction_revision bigint, p_subject_binding_revision bigint, p_nonce_hash text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, private
as $function$
declare
  v_profile public.profiles%rowtype;
  v_subject public.subjects%rowtype;
  v_artifact public.consent_artifacts%rowtype;
  v_principal uuid;
  v_signature uuid;
  v_signed_at timestamptz;
  v_expected_keys text[];
  v_nonce public.account_operation_nonces%rowtype;
begin
  -- This unexposed helper is callable only by the verified service route.
  -- No ordinary upload requires the destructive-action 15-minute re-login rule.
  perform 1 from auth.users u where u.id = p_account_id and u.deleted_at is null for share;
  if not found then raise exception using errcode='42501', message='not_found'; end if;
  perform 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_account_id
    and (s.not_after is null or s.not_after > clock_timestamp()) for share;
  if not found then raise exception using errcode='42501', message='not_found'; end if;
  select * into v_profile from public.profiles where id=p_account_id for update;
  if v_profile.id is null or v_profile.deletion_requested_at is not null
    or v_profile.account_revision is distinct from p_account_revision
    or v_profile.auth_session_revision is distinct from p_auth_session_revision
    or v_profile.jurisdiction_revision is distinct from p_jurisdiction_revision then
    raise exception using errcode='42501', message='not_found';
  end if;
  if v_profile.date_of_birth is null
    or v_profile.date_of_birth > (timezone('UTC',clock_timestamp())::date - interval '18 years')::date then
    raise exception using errcode='55000', message='adult_account_required';
  end if;
  select * into v_subject from public.subjects where id=p_subject_id for update;
  if v_subject.id is null or v_subject.subject_account_id is distinct from p_account_id
    or v_subject.subject_class not in ('self','other_adult')
    or v_subject.lifecycle not in ('active','claimed_bound')
    or v_subject.subject_binding_revision is distinct from p_subject_binding_revision then
    raise exception using errcode='42501', message='not_found';
  end if;
  select sp.id into v_principal from public.subject_principals sp
    join public.subject_account_bindings b on b.subject_id=sp.subject_id
      and b.subject_principal_id=sp.id and b.account_id=p_account_id
      and b.status='current' and b.binding_revision=p_subject_binding_revision
    where sp.subject_id=p_subject_id and sp.account_id=p_account_id
      and sp.principal_kind='account_subject' and sp.status='active'
    for share of sp,b;
  if v_principal is null then raise exception using errcode='42501', message='not_found'; end if;
  v_expected_keys := case p_artifact_key
    when 'consent.upload-self' then array['own-adult-dna']
    when 'disclosure.insurance-and-discrimination' then array['understood']
    else null end;
  if v_expected_keys is null or p_statement_keys is distinct from v_expected_keys then
    raise exception using errcode='22023', message='invalid_request';
  end if;
  select * into v_artifact from public.consent_artifacts
    where artifact_key=p_artifact_key and version=p_artifact_version
      and superseded_at is null and published_at<=clock_timestamp()
      and effective_on<=timezone('UTC',clock_timestamp())::date for share;
  if v_artifact.artifact_key is null
    or v_artifact.body_sha256 is distinct from p_artifact_body_sha256
    or encode(extensions.digest(convert_to(v_artifact.body_markdown,'UTF8'),'sha256'),'hex')
       is distinct from p_artifact_body_sha256 then
    raise exception using errcode='55000', message='consent_artifact_changed';
  end if;
  -- Insurance is a distinct prior decision, never implied by the class checkbox.
  if p_artifact_key='consent.upload-self' and not exists (
    select 1 from public.consent_signatures cs join public.consent_artifacts ca
      on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
      and ca.body_sha256=cs.artifact_body_sha256 and ca.superseded_at is null
      and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
      and encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')=ca.body_sha256
    where cs.target_kind='subject' and cs.target_id=p_subject_id
      and cs.signer_account_id=p_account_id and cs.signer_principal_id=v_principal
      and cs.artifact_key='disclosure.insurance-and-discrimination'
      and cs.jurisdiction_revision=p_jurisdiction_revision
      and cs.subject_binding_revision=p_subject_binding_revision
  ) then raise exception using errcode='55000', message='insurance_acknowledgement_required'; end if;
  select * into v_nonce from public.account_operation_nonces where nonce_hash=p_nonce_hash for update;
  if v_nonce.nonce_hash is null or v_nonce.account_id is distinct from p_account_id
    or v_nonce.session_id is distinct from p_session_id
    or v_nonce.operation<>'own_upload_artifact_sign' or v_nonce.consumed_at is not null
    or v_nonce.expires_at<=clock_timestamp() then
    raise exception using errcode='42501', message='not_found';
  end if;
  update public.account_operation_nonces set consumed_at=clock_timestamp()
    where nonce_hash=p_nonce_hash;
  insert into public.consent_signatures (artifact_key,artifact_version,artifact_body_sha256,
    signer_principal_id,signer_account_id,target_kind,target_id,purpose,statement_keys,
    jurisdiction_code,jurisdiction_revision,subject_binding_revision)
  values (p_artifact_key,p_artifact_version,p_artifact_body_sha256,v_principal,p_account_id,
    'subject',p_subject_id,case when p_artifact_key='consent.upload-self' then 'store' else 'insurance_acknowledgement' end,
    v_expected_keys,coalesce(v_profile.jurisdiction_code,'ZZ'),p_jurisdiction_revision,p_subject_binding_revision)
  returning id,signed_at into v_signature,v_signed_at;
  if p_artifact_key='consent.upload-self' then
    update public.subject_consents set revoked_at=v_signed_at,revocation_reason='superseded'
      where subject_id=p_subject_id and account_id=p_account_id
        and consent_type='upload_class' and revoked_at is null;
    insert into public.subject_consents(signature_id,subject_id,account_id,consent_type,scope)
      values(v_signature,p_subject_id,p_account_id,'upload_class',array['store']);
  end if;
  return jsonb_build_object('recordKind','artifact_signature','recordId',v_signature,
    'artifactKey',p_artifact_key,'artifactVersion',p_artifact_version,'signedAt',v_signed_at);
end;
$function$;
revoke all on function private.sign_own_upload_artifact_v1(uuid, uuid, uuid, text, integer, text, text[], bigint, bigint, bigint, bigint, text) from public, anon, authenticated;
grant execute on function private.sign_own_upload_artifact_v1(uuid, uuid, uuid, text, integer, text, text[], bigint, bigint, bigint, bigint, text) to service_role;

create function public.sign_own_upload_artifact_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid,
  p_artifact_key text, p_artifact_version integer, p_artifact_body_sha256 text,
  p_statement_keys text[], p_account_revision bigint, p_auth_session_revision bigint,
  p_jurisdiction_revision bigint, p_subject_binding_revision bigint, p_nonce_hash text)
returns jsonb language sql security invoker set search_path = pg_catalog
as $function$
  select private.sign_own_upload_artifact_v1(p_account_id,p_session_id,p_subject_id,
    p_artifact_key,p_artifact_version,p_artifact_body_sha256,p_statement_keys,p_account_revision,
    p_auth_session_revision,p_jurisdiction_revision,p_subject_binding_revision,p_nonce_hash);
$function$;
revoke all on function public.sign_own_upload_artifact_v1(uuid, uuid, uuid, text, integer, text, text[], bigint, bigint, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.sign_own_upload_artifact_v1(uuid, uuid, uuid, text, integer, text, text[], bigint, bigint, bigint, bigint, text) to service_role;
