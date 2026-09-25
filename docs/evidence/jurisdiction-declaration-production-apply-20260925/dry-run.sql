-- Guarded production apply of supabase/migrations/20260925140000_jurisdiction_declaration.sql
-- (merged in #212; file SHA-256 02b2a2722669514eae234291541075920a24b1b96c1595da695d96933558e316).
-- One DO statement, so it is atomic under any client protocol: predecessor checks,
-- the migration executed verbatim, postchecks against the definitions measured on
-- the tested local stack, and the ledger row under the repository's version and name.
do $inherit_jd_do$
declare
  migration constant text := $inherit_jd_migration$-- G5.1a/G5.1b: the one writer for the user-declared jurisdiction (ADR 0032).
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
$inherit_jd_migration$;
  profiles_before bigint;
begin
  if md5(migration) <> '97c3f2f6d38c7713cb62e134869e35f0' then
    raise exception using message = 'integrity: the embedded migration text is not the reviewed file'; end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20260925140000') then
    raise exception using message = 'predecessor: 20260925140000 is already in the ledger'; end if;
  if not exists (select 1 from supabase_migrations.schema_migrations
      where version = '20260925130000' and name = 'export_archive_content_reader') then
    raise exception using message = 'predecessor: the export content reader row is missing'; end if;
  if to_regprocedure('public.declare_jurisdiction_v1(uuid,uuid,text,integer,text,boolean)') is not null or to_regprocedure('private.guard_profile_jurisdiction_v1()') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
       and column_name in ('jurisdiction_declared_at', 'jurisdiction_attestation_version', 'jurisdiction_attestation_sha256'))
     or exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_jurisdiction_server_only')
     or exists (select 1 from public.consent_artifacts where artifact_key = 'attestation.jurisdiction') then
    raise exception using message = 'predecessor: declaration objects already exist'; end if;
  -- The new check constraint requires every stored code to carry its declaration record.
  if exists (select 1 from public.profiles where jurisdiction_code is not null) then
    raise exception using message = 'predecessor: a profile already holds a jurisdiction code'; end if;
  if (select string_agg(conname || ':' || md5(pg_get_constraintdef(oid)), ',' order by conname)
      from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'c')
     is distinct from 'profiles_account_revision_check:efc91cc643578d428e0d787be3b26fa2,profiles_auth_session_revision_check:add7699b53d1009859312001674edb41,profiles_copilot_settings_revision_check:4d11c5e9b40f385166907ba1a6cf93ca,profiles_jurisdiction_code_check:b89464702f03317bb620b7e1487cd5f4,profiles_jurisdiction_revision_check:3b6e0ce65a0fed72c503fe0ed80f948f,profiles_mail_contact_revision_check:41d63030d2ca8f4fcd1e0ab636752aa5' then
    raise exception using message = 'predecessor: profile check constraints differ from the tested set'; end if;
  if md5((select pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.consent_artifacts'::regclass
      and tgname = 'consent_artifacts_immutable')) is distinct from '51fc589cded54ef88ba2264156ca3dc1' then
    raise exception using message = 'predecessor: the consent artifact immutability trigger differs'; end if;
  if (select count(*) from information_schema.columns where table_schema = 'auth'
      and ((table_name = 'sessions' and column_name in ('id', 'user_id', 'not_after'))
        or (table_name = 'users' and column_name in ('id', 'deleted_at')))) <> 5
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using message = 'predecessor: an auth column or extensions.digest is missing'; end if;
  if md5(pg_get_functiondef('private.append_legal_audit_event(text,uuid,text,text,jsonb)'::regprocedure)) <> '5d7a70e225d949aafa2b6fc6025e3455' then
    raise exception using message = 'predecessor: private.append_legal_audit_event(text,uuid,text,text,jsonb) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('public.revoke_directional_purpose_v1(uuid,uuid)'::regprocedure)) <> '4f27d161fa534eee20f4c099eef2e61e' then
    raise exception using message = 'predecessor: public.revoke_directional_purpose_v1(uuid,uuid) differs from the tested definition'; end if;
  select count(*) into profiles_before from public.profiles;

  execute migration;

  if md5(pg_get_functiondef('private.guard_profile_jurisdiction_v1()'::regprocedure)) <> 'd3f4c02bc5074fb4f78c5d491bf82ba9' then
    raise exception using message = 'postcheck: private.guard_profile_jurisdiction_v1() differs from the tested definition'; end if;
  if md5(pg_get_functiondef('public.declare_jurisdiction_v1(uuid,uuid,text,integer,text,boolean)'::regprocedure)) <> '01e02e78ebbd5f741d853b5b537dcbb2' then
    raise exception using message = 'postcheck: public.declare_jurisdiction_v1(uuid,uuid,text,integer,text,boolean) differs from the tested definition'; end if;
  if not exists (select 1 from pg_proc where oid = 'public.declare_jurisdiction_v1(uuid,uuid,text,integer,text,boolean)'::regprocedure
      and prosecdef and proconfig = array['search_path=""']) then
    raise exception using message = 'postcheck: the writer is not security definer with an empty search path'; end if;
  if md5((select pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.profiles'::regclass
      and tgname = 'profiles_jurisdiction_server_only')) is distinct from '529e2c2b8b35df5c5c7ea3b3db5f3b69' then
    raise exception using message = 'postcheck: the profile guard trigger differs'; end if;
  if md5((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_jurisdiction_declaration_check')) is distinct from 'cc367821a74a77712a8b03169a649fa5' then
    raise exception using message = 'postcheck: the declaration check constraint differs'; end if;
  if (select string_agg(column_name || ':' || data_type, ',' order by column_name) from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name like 'jurisdiction%')
     is distinct from 'jurisdiction_attestation_sha256:text,jurisdiction_attestation_version:integer,jurisdiction_code:text,jurisdiction_declared_at:timestamp with time zone,jurisdiction_revision:bigint' then
    raise exception using message = 'postcheck: profile jurisdiction columns differ'; end if;
  if (select count(*) from public.consent_artifacts where artifact_key = 'attestation.jurisdiction' and version = 1
      and body_sha256 = '7cfbbe7cf54bc5e5e376bcf8f7b916ad9598826755021a56fe613bae6bea0efd'
      and body_sha256 = encode(extensions.digest(convert_to(body_markdown, 'UTF8'), 'sha256'), 'hex')
      and superseded_at is null and effective_on = date '2026-09-25') <> 1
     or (select count(*) from public.consent_artifacts where artifact_key = 'attestation.jurisdiction') <> 1 then
    raise exception using message = 'postcheck: the jurisdiction attestation is not exactly the published text'; end if;
  if has_function_privilege('anon', 'public.declare_jurisdiction_v1(uuid,uuid,text,integer,text,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.declare_jurisdiction_v1(uuid,uuid,text,integer,text,boolean)', 'execute')
     or has_function_privilege('inherit_upload_only', 'public.declare_jurisdiction_v1(uuid,uuid,text,integer,text,boolean)', 'execute')
     or has_function_privilege('anon', 'private.guard_profile_jurisdiction_v1()', 'execute')
     or has_function_privilege('authenticated', 'private.guard_profile_jurisdiction_v1()', 'execute')
     or has_function_privilege('inherit_upload_only', 'private.guard_profile_jurisdiction_v1()', 'execute') then
    raise exception using message = 'postcheck: a browser role can execute a declaration function'; end if;
  if not has_function_privilege('service_role', 'public.declare_jurisdiction_v1(uuid,uuid,text,integer,text,boolean)', 'execute') then
    raise exception using message = 'postcheck: service_role cannot execute the writer'; end if;
  if (select count(*) from public.profiles) <> profiles_before
     or exists (select 1 from public.profiles where jurisdiction_code is not null or jurisdiction_declared_at is not null
       or jurisdiction_revision <> 1) then
    raise exception using message = 'postcheck: profile rows changed'; end if;
  if md5(pg_get_functiondef('private.append_legal_audit_event(text,uuid,text,text,jsonb)'::regprocedure)) <> '5d7a70e225d949aafa2b6fc6025e3455' then
    raise exception using message = 'postcheck: private.append_legal_audit_event(text,uuid,text,text,jsonb) differs from the tested definition'; end if;
  if md5(pg_get_functiondef('public.revoke_directional_purpose_v1(uuid,uuid)'::regprocedure)) <> '4f27d161fa534eee20f4c099eef2e61e' then
    raise exception using message = 'postcheck: public.revoke_directional_purpose_v1(uuid,uuid) differs from the tested definition'; end if;

  insert into supabase_migrations.schema_migrations (version, name, statements)
  values ('20260925140000', 'jurisdiction_declaration', array[migration]);
  raise exception using message = 'DRY_RUN_COMPLETE_ALL_CHECKS_PASSED';
end
$inherit_jd_do$;
