-- Server-owned compatibility bridge for cloud-model consent while the chat
-- runtime transitions from legacy consent_grants to subject_consents.

insert into public.consent_artifacts (
  artifact_key, version, body_sha256, body_markdown, summary_markdown,
  effective_on
)
select
  'consent.copilot-cloud-model',
  1,
  encode(digest(convert_to(
    'Authorize the selected cloud model provider to process the named genome-derived data classes for Copilot answers. Raw uploaded files are excluded and the authorization is revocable.',
    'UTF8'
  ), 'sha256'), 'hex'),
  'Authorize the selected cloud model provider to process the named genome-derived data classes for Copilot answers. Raw uploaded files are excluded and the authorization is revocable.',
  'Cloud-model processing is limited to the provider and data classes named at consent time.',
  date '2026-09-01'
where not exists (
  select 1 from public.consent_artifacts
  where artifact_key = 'consent.copilot-cloud-model' and version = 1
);

create or replace function public.grant_cloud_model_consent(
  p_account_id uuid,
  p_provider_key text,
  p_data_classes text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject public.subjects%rowtype;
  v_principal public.subject_principals%rowtype;
  v_profile public.profiles%rowtype;
  v_artifact public.consent_artifacts%rowtype;
  v_signature_id uuid;
  v_legacy_id uuid;
begin
  if nullif(btrim(p_provider_key), '') is null
    or char_length(p_provider_key) > 255
    or cardinality(p_data_classes) <> 5 then
    raise exception using errcode = '22023', message = 'invalid cloud consent';
  end if;

  select * into v_subject from public.subjects
  where subject_account_id = p_account_id
    and subject_class = 'self'
    and lifecycle = 'active';
  select * into v_principal from public.subject_principals
  where subject_id = v_subject.id
    and account_id = p_account_id
    and principal_kind = 'account_subject'
    and status = 'active';
  select * into v_profile from public.profiles where id = p_account_id;
  select * into v_artifact from public.consent_artifacts
  where artifact_key = 'consent.copilot-cloud-model' and version = 1;
  if v_subject.id is null or v_principal.id is null or v_profile.id is null or v_artifact.artifact_key is null then
    raise exception using errcode = '42501', message = 'cloud consent authority is unavailable';
  end if;

  select id into v_legacy_id from public.consent_grants
  where user_id = p_account_id and provider_key = p_provider_key and revoked_at is null;
  if v_legacy_id is not null then return v_legacy_id; end if;

  insert into public.consent_signatures (
    artifact_key, artifact_version, artifact_body_sha256,
    signer_principal_id, signer_account_id, target_kind, target_id,
    purpose, statement_keys, jurisdiction_code, jurisdiction_revision,
    subject_binding_revision
  ) values (
    v_artifact.artifact_key, v_artifact.version, v_artifact.body_sha256,
    v_principal.id, p_account_id, 'subject', v_subject.id,
    'copilot-cloud-model:' || p_provider_key,
    array['provider-named', 'data-classes-named', 'raw-file-excluded', 'revocable'],
    coalesce(v_profile.jurisdiction_code, 'ZZ'),
    v_profile.jurisdiction_revision,
    v_subject.subject_binding_revision
  ) returning id into v_signature_id;

  insert into public.subject_consents (
    signature_id, subject_id, account_id, consent_type, scope,
    provider_key, grant_revision
  ) values (
    v_signature_id, v_subject.id, p_account_id, 'cloud_model',
    p_data_classes, p_provider_key, 1
  );

  insert into public.consent_grants (user_id, provider_key, data_classes)
  values (p_account_id, p_provider_key, p_data_classes)
  returning id into v_legacy_id;
  return v_legacy_id;
end;
$$;

create or replace function public.revoke_cloud_model_consent(
  p_grant_id uuid,
  p_account_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_key text;
begin
  update public.consent_grants
  set revoked_at = clock_timestamp()
  where id = p_grant_id and user_id = p_account_id and revoked_at is null
  returning provider_key into v_provider_key;
  if v_provider_key is null then return false; end if;

  update public.subject_consents
  set revoked_at = clock_timestamp(), revocation_reason = 'withdrawn'
  where account_id = p_account_id
    and consent_type = 'cloud_model'
    and provider_key = v_provider_key
    and revoked_at is null;
  return true;
end;
$$;

revoke all on function public.grant_cloud_model_consent(uuid, text, text[])
  from public, anon, authenticated;
grant execute on function public.grant_cloud_model_consent(uuid, text, text[])
  to service_role;
revoke all on function public.revoke_cloud_model_consent(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_cloud_model_consent(uuid, uuid)
  to service_role;
