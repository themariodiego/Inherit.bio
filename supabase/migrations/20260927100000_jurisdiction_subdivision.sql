-- A state (ISO 3166-2 subdivision) beside the declared country (ADR 0032,
-- amended 27 September 2026).
--
-- The owner decided on 27 September 2026 to prepare a United States launch of
-- the partner features, where New York and several other states must be
-- decided separately from the rest. The runtime resolver has always answered a
-- committed subdivision for itself; nothing could declare one. This adds the
-- declaration and nothing else: every committed subdivision is unreviewed, so
-- no capability changes for anyone.
--
-- The state lives in its own column rather than in jurisdiction_code. That
-- column is copied into consent signatures and grants, whose checks hold two
-- letters, and adult self-analysis signs through it. Only the restricted
-- capability resolver reads the state, and only it needs to.

alter table public.profiles
 add column jurisdiction_subdivision text,
 add constraint profiles_jurisdiction_subdivision_check check (
  jurisdiction_subdivision is null
  or (jurisdiction_code is not null
    and jurisdiction_subdivision ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$'
    and left(jurisdiction_subdivision, 2) = jurisdiction_code));

-- The state is part of the declaration, so it is server-only like the rest.
create or replace function private.guard_profile_jurisdiction_v1()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $function$
begin
  if current_user in ('anon','authenticated','inherit_upload_only') and (
    (TG_OP='INSERT' and (new.jurisdiction_code is not null or new.jurisdiction_revision <> 1
      or new.jurisdiction_subdivision is not null
      or new.jurisdiction_declared_at is not null or new.jurisdiction_attestation_version is not null
      or new.jurisdiction_attestation_sha256 is not null))
    or (TG_OP='UPDATE' and (new.jurisdiction_code is distinct from old.jurisdiction_code
      or new.jurisdiction_subdivision is distinct from old.jurisdiction_subdivision
      or new.jurisdiction_revision is distinct from old.jurisdiction_revision
      or new.jurisdiction_declared_at is distinct from old.jurisdiction_declared_at
      or new.jurisdiction_attestation_version is distinct from old.jurisdiction_attestation_version
      or new.jurisdiction_attestation_sha256 is distinct from old.jurisdiction_attestation_sha256))
  ) then raise exception using errcode='42501', message='jurisdiction_server_only'; end if;
  return new;
end;
$function$;

-- The attestation now covers the state as well. Version 1 is superseded; a
-- page still showing it is refused by the writer, as for any stale text. The
-- signed body is preserved: only superseded_at changes, under the same guarded
-- transition the own-report and own-Copilot v2 artifacts used.
do $migration$
declare affected integer;
begin
 lock table public.consent_artifacts in access exclusive mode;
 alter table public.consent_artifacts disable trigger consent_artifacts_immutable;
 update public.consent_artifacts set superseded_at = clock_timestamp()
 where artifact_key = 'attestation.jurisdiction' and version = 1 and superseded_at is null
  and body_sha256 = '7cfbbe7cf54bc5e5e376bcf8f7b916ad9598826755021a56fe613bae6bea0efd';
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'expected exactly one unchanged jurisdiction attestation v1'; end if;
 alter table public.consent_artifacts enable trigger consent_artifacts_immutable;
end
$migration$;

insert into public.consent_artifacts
  (artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on,summary_of_changes)
values ('attestation.jurisdiction',2,'a73dfd013468233d9b22c902f33f43f6614565e0ba07c459d8cab89e71b1b917',
$artifact$You tell Inherit which country you live in. If you live in the United States, you also tell Inherit which state.

Inherit uses your answer to decide which features the law there allows. Your own DNA results do not depend on it. Family, Portrait, carrier and embryo features do. Each of them stays off until a qualified person has reviewed the law where you live.

Inherit does not check your answer and never guesses it. It does not use your internet address, your browser language or your time zone for this.

If you move, change your answer in Settings. When you change it, the Family and embryo permissions you gave under your old answer end. You are asked again before any of them is used.

What you confirm:

1. The place I chose is where I live.$artifact$,
'You tell Inherit which country you live in, and your state if you live in the United States. Inherit uses it to decide which Family and embryo features the law there allows. It never guesses where you are.',
date '2026-09-27',
'Adds the state for people who live in the United States.');

-- The one writer, now with the state. Service-only, like version 1: the route
-- validates the country and the state against data/jurisdictions.json, and
-- the database re-checks what it can hold itself. A changed country or state
-- ends every current restricted grant, exactly as a changed country did.
create function public.declare_jurisdiction_v2(p_account_id uuid, p_session_id uuid, p_code text,
  p_subdivision text, p_attestation_version integer, p_attestation_sha256 text, p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_profile public.profiles%rowtype;
  v_first boolean;
  v_changed boolean;
  v_grant record;
  v_revoked integer := 0;
begin
  if p_account_id is null or p_session_id is null or p_code is null or p_code !~ '^[A-Z]{2}$'
    or (p_subdivision is not null and (p_subdivision !~ '^[A-Z]{2}-[A-Z0-9]{1,3}$'
      or left(p_subdivision, 2) <> p_code or p_code = 'XX'))
    or p_attestation_version is null or p_attestation_version < 1
    or p_attestation_sha256 is null or p_attestation_sha256 !~ '^[0-9a-f]{64}$'
    or p_test_jurisdiction is null or (p_code = 'XX' and not p_test_jurisdiction) then
    raise exception using errcode='22023', message='invalid_request';
  end if;
  perform 1 from auth.users u where u.id = p_account_id and u.deleted_at is null for share;
  if not found then raise exception using errcode='42501', message='not_found'; end if;
  perform 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_account_id
    and (s.not_after is null or s.not_after > v_now) for share;
  if not found then raise exception using errcode='42501', message='not_found'; end if;
  -- Concurrent declarations serialize here; each one is audited in order.
  select * into v_profile from public.profiles where id = p_account_id for update;
  if v_profile.id is null or v_profile.deletion_requested_at is not null then
    raise exception using errcode='42501', message='not_found';
  end if;
  if not exists (select 1 from public.consent_artifacts ca
    where ca.artifact_key = 'attestation.jurisdiction' and ca.version = p_attestation_version
      and ca.body_sha256 = p_attestation_sha256 and ca.superseded_at is null and ca.published_at <= v_now
      and ca.effective_on <= timezone('UTC', v_now)::date
      and ca.body_sha256 = encode(extensions.digest(convert_to(ca.body_markdown, 'UTF8'), 'sha256'), 'hex')) then
    raise exception using errcode='22023', message='invalid_request';
  end if;

  v_first := v_profile.jurisdiction_code is null;
  v_changed := v_profile.jurisdiction_code is distinct from p_code
    or v_profile.jurisdiction_subdivision is distinct from p_subdivision;
  if not v_changed and v_profile.jurisdiction_attestation_version = p_attestation_version
    and v_profile.jurisdiction_attestation_sha256 = p_attestation_sha256 then
    return jsonb_build_object('jurisdiction', p_code, 'subdivision', p_subdivision,
      'changed', false, 'revokedGrants', 0);
  end if;

  update public.profiles set jurisdiction_code = p_code, jurisdiction_subdivision = p_subdivision,
    jurisdiction_declared_at = v_now,
    jurisdiction_attestation_version = p_attestation_version,
    jurisdiction_attestation_sha256 = p_attestation_sha256
  where id = p_account_id;

  if v_changed then
    for v_grant in
      select pg.grant_id, pg.purpose, dsp.account_id as data_subject_account_id
      from public.purpose_grants pg
      join public.directional_grants dg on dg.grant_id = pg.grant_id and dg.grant_revision = pg.grant_revision
      left join public.subject_principals dsp on dsp.id = pg.data_subject_principal_id
      left join public.subject_principals ssp on ssp.id = pg.signer_principal_id
      where pg.revoked_at is null and dg.status = 'current'
        and (dsp.account_id = p_account_id or ssp.account_id = p_account_id
          or dg.recipient_account_id = p_account_id
          or exists (select 1 from public.consent_signatures cs
            where cs.id = pg.signature_id and cs.signer_account_id = p_account_id))
        -- Export is a right with a jurisdiction bypass (register purpose-to-capability-v1).
        and pg.purpose <> 'export.share-link'
        -- Adult self-analysis: the account's own subject, signed by and about itself.
        and not (dg.direction = 'self' and pg.target_kind = 'subject'
          and pg.data_subject_principal_id = pg.signer_principal_id
          and pg.purpose in ('reports.monogenic','reports.polygenic','ancestry',
            'copilot.local','copilot.cloud','raw.export','raw.browse')
          and exists (select 1 from public.subjects s
            where s.id = pg.target_id and s.subject_account_id = p_account_id))
      order by pg.grant_id
      for update of pg, dg
    loop
      if v_grant.data_subject_account_id is not null then
        perform public.revoke_directional_purpose_v1(v_grant.data_subject_account_id, v_grant.grant_id);
        update public.purpose_grants set revocation_reason = 'jurisdiction_changed'
        where grant_id = v_grant.grant_id;
      else
        update public.purpose_grants set revoked_at = v_now, revocation_reason = 'jurisdiction_changed'
        where grant_id = v_grant.grant_id;
        update public.directional_grants set status = 'revoked', ended_at = v_now
        where grant_id = v_grant.grant_id;
        perform private.append_legal_audit_event('purpose.revoked', null, 'api.jurisdiction', 'accepted',
          jsonb_build_object('purpose', v_grant.purpose, 'reason', 'jurisdiction_changed'));
      end if;
      v_revoked := v_revoked + 1;
    end loop;
  end if;

  perform private.append_legal_audit_event(
    case when v_changed then 'jurisdiction.declared' else 'jurisdiction.reaffirmed' end,
    null, 'api.jurisdiction', 'accepted',
    -- The state is added only when one is declared, so every other event keeps
    -- version 1's exact shape.
    jsonb_build_object('code', p_code, 'first', v_first,
      'attestation_version', p_attestation_version, 'revoked_grants', v_revoked)
      || case when p_subdivision is null then '{}'::jsonb
         else jsonb_build_object('subdivision', p_subdivision) end);
  return jsonb_build_object('jurisdiction', p_code, 'subdivision', p_subdivision,
    'changed', v_changed, 'revokedGrants', v_revoked);
end;
$function$;
revoke all on function public.declare_jurisdiction_v2(uuid, uuid, text, text, integer, text, boolean)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function public.declare_jurisdiction_v2(uuid, uuid, text, text, integer, text, boolean) to service_role;

-- Version 1 stays for the application build that is live when this is
-- applied, and keeps its exact result shape, which that build parses strictly.
-- It keeps the recorded state while the country is unchanged, so re-saving the
-- same country from an older page does not end anyone's permissions.
create or replace function public.declare_jurisdiction_v1(p_account_id uuid, p_session_id uuid, p_code text,
  p_attestation_version integer, p_attestation_sha256 text, p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_subdivision text;
begin
  select case when p.jurisdiction_code = p_code then p.jurisdiction_subdivision end into v_subdivision
  from public.profiles p where p.id = p_account_id;
  return public.declare_jurisdiction_v2(p_account_id, p_session_id, p_code, v_subdivision,
    p_attestation_version, p_attestation_sha256, p_test_jurisdiction) - 'subdivision';
end;
$function$;
revoke all on function public.declare_jurisdiction_v1(uuid, uuid, text, integer, text, boolean)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function public.declare_jurisdiction_v1(uuid, uuid, text, integer, text, boolean) to service_role;
