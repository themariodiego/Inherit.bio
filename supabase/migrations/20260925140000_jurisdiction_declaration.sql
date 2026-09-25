-- G5.1a/G5.1b: the one writer for the user-declared jurisdiction (ADR 0032).
--
-- Until now nothing wrote profiles.jurisdiction_code, and the table-level
-- profile grants let a signed-in browser set its own code and revision
-- directly (D-135): the own-row RLS policy allows UPDATE and no guard covered
-- these columns. The guard below closes that; the declaration RPC is the only
-- path that changes a declaration, and it records the attestation the person
-- affirmed and appends one legal-audit event.
--
-- Re-evaluation. Every current signature and grant binds the account's
-- jurisdiction revision, the signature row is immutable, and completed own
-- reports store that revision in their authority context. Bumping it would
-- therefore end every own-genome permission and hide every saved report,
-- although adult self-analysis is the one capability no jurisdiction
-- restricts. So the revision is not bumped. Instead a changed code ends every
-- current restricted grant this account takes part in, as signer, data
-- subject or recipient: the register's "require re-signing" disposition. A
-- restricted permission's jurisdiction is part of its immutable signature,
-- and a family share's snapshot already binds both parties' codes, so a
-- share whose either side changed country could no longer be read anyway;
-- ending it makes that explicit and runs the ordinary withdrawal clean-up.
-- Own adult self-analysis, raw access and Copilot on the account's own
-- subject, and the export right, stay current.

alter table public.profiles
 add column jurisdiction_declared_at timestamptz,
 add column jurisdiction_attestation_version integer,
 add column jurisdiction_attestation_sha256 text,
 add constraint profiles_jurisdiction_declaration_check check (
  (jurisdiction_code is null) = (jurisdiction_declared_at is null)
  and (jurisdiction_code is null) = (jurisdiction_attestation_version is null)
  and (jurisdiction_code is null) = (jurisdiction_attestation_sha256 is null)
  and (jurisdiction_attestation_version is null or jurisdiction_attestation_version > 0)
  and (jurisdiction_attestation_sha256 is null or jurisdiction_attestation_sha256 ~ '^[0-9a-f]{64}$'));

-- Existing table-level profile grants must not make a declaration, or the
-- revision every consent binds, client-writable.
create function private.guard_profile_jurisdiction_v1()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $function$
begin
  if current_user in ('anon','authenticated','inherit_upload_only') and (
    (TG_OP='INSERT' and (new.jurisdiction_code is not null or new.jurisdiction_revision <> 1
      or new.jurisdiction_declared_at is not null or new.jurisdiction_attestation_version is not null
      or new.jurisdiction_attestation_sha256 is not null))
    or (TG_OP='UPDATE' and (new.jurisdiction_code is distinct from old.jurisdiction_code
      or new.jurisdiction_revision is distinct from old.jurisdiction_revision
      or new.jurisdiction_declared_at is distinct from old.jurisdiction_declared_at
      or new.jurisdiction_attestation_version is distinct from old.jurisdiction_attestation_version
      or new.jurisdiction_attestation_sha256 is distinct from old.jurisdiction_attestation_sha256))
  ) then raise exception using errcode='42501', message='jurisdiction_server_only'; end if;
  return new;
end;
$function$;
revoke all on function private.guard_profile_jurisdiction_v1() from public, anon, authenticated, inherit_upload_only;
create trigger profiles_jurisdiction_server_only before insert or update on public.profiles
  for each row execute function private.guard_profile_jurisdiction_v1();

insert into public.consent_artifacts
  (artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on)
values ('attestation.jurisdiction',1,'7cfbbe7cf54bc5e5e376bcf8f7b916ad9598826755021a56fe613bae6bea0efd',
$artifact$You tell Inherit which country you live in.

Inherit uses your answer to decide which features the law there allows. Your own DNA results do not depend on it. Family, Portrait, carrier and embryo features do. Each of them stays off until a qualified person has reviewed the law in your country.

Inherit does not check your answer and never guesses it. It does not use your internet address, your browser language or your time zone for this.

If you move, change your answer in Settings. When you change it, the Family and embryo permissions you gave under your old answer end. You are asked again before any of them is used.

What you confirm:

1. The country I chose is the country I live in.$artifact$,
'You tell Inherit which country you live in. Inherit uses it to decide which Family and embryo features the law there allows. It never guesses where you are.',
date '2026-09-25');

-- Service-only: the route resolves the account and session, validates the
-- code against data/jurisdictions.json and passes whether the isolated test
-- fixture is enabled. The database re-checks everything it can hold itself.
-- 'XX' is the ISO user-assigned code the block-only TEST-DENY fixture is
-- stored as; it is accepted only when the caller says the fixture is on.
create function public.declare_jurisdiction_v1(p_account_id uuid, p_session_id uuid, p_code text,
  p_attestation_version integer, p_attestation_sha256 text, p_test_jurisdiction boolean)
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
  v_changed := v_profile.jurisdiction_code is distinct from p_code;
  if not v_changed and v_profile.jurisdiction_attestation_version = p_attestation_version
    and v_profile.jurisdiction_attestation_sha256 = p_attestation_sha256 then
    return jsonb_build_object('jurisdiction', p_code, 'changed', false, 'revokedGrants', 0);
  end if;

  update public.profiles set jurisdiction_code = p_code, jurisdiction_declared_at = v_now,
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
        -- The existing withdrawal path, run for the account whose data it
        -- is, so derived rows, pairs and purge jobs are handled exactly as
        -- that person's own revocation handles them.
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
    jsonb_build_object('code', p_code, 'first', v_first, 'attestation_version', p_attestation_version,
      'revoked_grants', v_revoked));
  return jsonb_build_object('jurisdiction', p_code, 'changed', v_changed, 'revokedGrants', v_revoked);
end;
$function$;
revoke all on function public.declare_jurisdiction_v1(uuid, uuid, text, integer, text, boolean)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function public.declare_jurisdiction_v1(uuid, uuid, text, integer, text, boolean) to service_role;
