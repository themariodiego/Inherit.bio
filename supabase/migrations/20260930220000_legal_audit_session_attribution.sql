-- G5.6: record who acted for the person events whose writers consume no
-- operation nonce. Same rule as 20260928160000: an actor is recorded only
-- when the transaction proves it, only on the closed list of person events,
-- and a second, different account makes it no one.
--
-- The proof here is the account's own live auth session, checked in the same
-- transaction: the route passes the session id from the verified JWT, and
-- private.note_legal_audit_session_actor_v1 locks that session row for the
-- named account (existing, not expired, account not deleted) before noting
-- the account. A session that is not the account's, or not live, refuses the
-- whole operation, exactly as the writers that already check one do.
--
-- - declare_jurisdiction_v2 already checks that session, so it gains one line
--   and no new version. Its body is otherwise byte-identical to
--   20260927100000.
-- - The other writers take no session, so each gains a v2 that takes one,
--   proves it and calls the unchanged v1 in the same transaction: chromosomal
--   sex, family sharing pause, resume and stop, direct purpose revocation,
--   the portrait acknowledgement, the adult-subject invitation, and the
--   adult-subject confirmation. v1 stays callable and still records no one,
--   which is never wrong, only incomplete.
-- - Not attributable: an adult-subject refusal or deletion and a co-parent
--   refusal are made through a rights session by someone who may have no
--   account, and the ledger's actor is an account pseudonym; rights-session
--   activation likewise names no account.

create function private.note_legal_audit_session_actor_v1(p_account_id uuid, p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_account_id is null or p_session_id is null then
    raise exception using errcode = '42501', message = 'not_found';
  end if;
  perform 1 from auth.users u where u.id = p_account_id and u.deleted_at is null for share;
  if not found then raise exception using errcode = '42501', message = 'not_found'; end if;
  perform 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_account_id
    and (s.not_after is null or s.not_after > clock_timestamp()) for share;
  if not found then raise exception using errcode = '42501', message = 'not_found'; end if;
  perform private.note_legal_audit_actor_v1(p_account_id);
end;
$$;
revoke all on function private.note_legal_audit_session_actor_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.declare_jurisdiction_v2(p_account_id uuid, p_session_id uuid, p_code text,
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
  -- The live session just checked is this account's own: record it as the
  -- actor of the person events this declaration appends (20260930220000).
  perform private.note_legal_audit_actor_v1(p_account_id);
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

create function private.declare_chromosomal_sex_v2(p_account_id uuid, p_session_id uuid, p_subject_id uuid, p_chromosomal_sex text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.note_legal_audit_session_actor_v1(p_account_id, p_session_id);
  return public.declare_chromosomal_sex_v1(p_account_id, p_subject_id, p_chromosomal_sex);
end;
$$;

create function public.declare_chromosomal_sex_v2(p_account_id uuid, p_session_id uuid, p_subject_id uuid, p_chromosomal_sex text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.declare_chromosomal_sex_v2(p_account_id, p_session_id, p_subject_id, p_chromosomal_sex);
$$;

create function private.pause_family_sharing_v2(p_account_id uuid, p_session_id uuid, p_counterpart_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.note_legal_audit_session_actor_v1(p_account_id, p_session_id);
  return public.pause_family_sharing_v1(p_account_id, p_counterpart_account_id);
end;
$$;

create function public.pause_family_sharing_v2(p_account_id uuid, p_session_id uuid, p_counterpart_account_id uuid)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.pause_family_sharing_v2(p_account_id, p_session_id, p_counterpart_account_id);
$$;

create function private.resume_family_sharing_v2(p_account_id uuid, p_session_id uuid, p_counterpart_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.note_legal_audit_session_actor_v1(p_account_id, p_session_id);
  return public.resume_family_sharing_v1(p_account_id, p_counterpart_account_id);
end;
$$;

create function public.resume_family_sharing_v2(p_account_id uuid, p_session_id uuid, p_counterpart_account_id uuid)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.resume_family_sharing_v2(p_account_id, p_session_id, p_counterpart_account_id);
$$;

create function private.stop_family_sharing_v2(p_account_id uuid, p_session_id uuid, p_counterpart_account_id uuid)
returns table (ended_at timestamptz, deleted_counts jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.note_legal_audit_session_actor_v1(p_account_id, p_session_id);
  return query select * from public.stop_family_sharing_v1(p_account_id, p_counterpart_account_id);
end;
$$;

create function public.stop_family_sharing_v2(p_account_id uuid, p_session_id uuid, p_counterpart_account_id uuid)
returns table (ended_at timestamptz, deleted_counts jsonb)
language sql
security invoker
set search_path = ''
as $$
  select * from private.stop_family_sharing_v2(p_account_id, p_session_id, p_counterpart_account_id);
$$;

create function private.revoke_directional_purpose_v2(p_account_id uuid, p_session_id uuid, p_grant_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.note_legal_audit_session_actor_v1(p_account_id, p_session_id);
  return public.revoke_directional_purpose_v1(p_account_id, p_grant_id);
end;
$$;

create function public.revoke_directional_purpose_v2(p_account_id uuid, p_session_id uuid, p_grant_id uuid)
returns timestamptz
language sql
security invoker
set search_path = ''
as $$
  select private.revoke_directional_purpose_v2(p_account_id, p_session_id, p_grant_id);
$$;

create function private.acknowledge_portrait_v2(p_account_id uuid, p_session_id uuid, p_subject_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.note_legal_audit_session_actor_v1(p_account_id, p_session_id);
  return public.acknowledge_portrait_v1(p_account_id, p_subject_id);
end;
$$;

create function public.acknowledge_portrait_v2(p_account_id uuid, p_session_id uuid, p_subject_id uuid)
returns timestamptz
language sql
security invoker
set search_path = ''
as $$
  select private.acknowledge_portrait_v2(p_account_id, p_session_id, p_subject_id);
$$;

create function private.create_adult_subject_invitation_v2(p_account_id uuid, p_session_id uuid, p_contact_ciphertext bytea, p_contact_hmac text, p_idempotency_key text, p_test_jurisdiction boolean, p_contact_hmac_set jsonb, p_quota_keys jsonb)
returns table (invitation_id uuid, subject_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.note_legal_audit_session_actor_v1(p_account_id, p_session_id);
  return query select * from public.create_adult_subject_invitation_v1(p_account_id, p_contact_ciphertext, p_contact_hmac, p_idempotency_key, p_test_jurisdiction, p_contact_hmac_set, p_quota_keys);
end;
$$;

create function public.create_adult_subject_invitation_v2(p_account_id uuid, p_session_id uuid, p_contact_ciphertext bytea, p_contact_hmac text, p_idempotency_key text, p_test_jurisdiction boolean, p_contact_hmac_set jsonb, p_quota_keys jsonb)
returns table (invitation_id uuid, subject_id uuid, expires_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  select * from private.create_adult_subject_invitation_v2(p_account_id, p_session_id, p_contact_ciphertext, p_contact_hmac, p_idempotency_key, p_test_jurisdiction, p_contact_hmac_set, p_quota_keys);
$$;

-- Confirming binds the reserved subject to the signed-in account, so a
-- confirmation names that account and its live auth session, and records it
-- as the actor. Refusing and deleting are answered from the rights session
-- alone, by a person who may hold no account: they record no one.
create function private.respond_adult_subject_invitation_session_v2(p_session_hash text, p_action text, p_nonce text,
  p_account_id uuid, p_auth_session_id uuid, p_account_email_hmac_set jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_account_id is not null or p_auth_session_id is not null then
    if p_account_id is null or p_auth_session_id is null then
      raise exception using errcode = '42501', message = 'not_found';
    end if;
    perform private.note_legal_audit_session_actor_v1(p_account_id, p_auth_session_id);
  end if;
  return public.respond_adult_subject_invitation_session_v1(p_session_hash, p_action, p_nonce, p_account_id,
    null, p_account_email_hmac_set);
end;
$$;

create function public.respond_adult_subject_invitation_session_v2(p_session_hash text, p_action text, p_nonce text,
  p_account_id uuid default null, p_auth_session_id uuid default null, p_account_email_hmac_set jsonb default null)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.respond_adult_subject_invitation_session_v2(p_session_hash, p_action, p_nonce, p_account_id,
    p_auth_session_id, p_account_email_hmac_set);
$$;

revoke all on function
  private.declare_chromosomal_sex_v2(uuid, uuid, uuid, text),
  public.declare_chromosomal_sex_v2(uuid, uuid, uuid, text),
  private.pause_family_sharing_v2(uuid, uuid, uuid),
  public.pause_family_sharing_v2(uuid, uuid, uuid),
  private.resume_family_sharing_v2(uuid, uuid, uuid),
  public.resume_family_sharing_v2(uuid, uuid, uuid),
  private.stop_family_sharing_v2(uuid, uuid, uuid),
  public.stop_family_sharing_v2(uuid, uuid, uuid),
  private.revoke_directional_purpose_v2(uuid, uuid, uuid),
  public.revoke_directional_purpose_v2(uuid, uuid, uuid),
  private.acknowledge_portrait_v2(uuid, uuid, uuid),
  public.acknowledge_portrait_v2(uuid, uuid, uuid),
  private.create_adult_subject_invitation_v2(uuid, uuid, bytea, text, text, boolean, jsonb, jsonb),
  public.create_adult_subject_invitation_v2(uuid, uuid, bytea, text, text, boolean, jsonb, jsonb),
  private.respond_adult_subject_invitation_session_v2(text, text, text, uuid, uuid, jsonb),
  public.respond_adult_subject_invitation_session_v2(text, text, text, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function
  private.declare_chromosomal_sex_v2(uuid, uuid, uuid, text),
  public.declare_chromosomal_sex_v2(uuid, uuid, uuid, text),
  private.pause_family_sharing_v2(uuid, uuid, uuid),
  public.pause_family_sharing_v2(uuid, uuid, uuid),
  private.resume_family_sharing_v2(uuid, uuid, uuid),
  public.resume_family_sharing_v2(uuid, uuid, uuid),
  private.stop_family_sharing_v2(uuid, uuid, uuid),
  public.stop_family_sharing_v2(uuid, uuid, uuid),
  private.revoke_directional_purpose_v2(uuid, uuid, uuid),
  public.revoke_directional_purpose_v2(uuid, uuid, uuid),
  private.acknowledge_portrait_v2(uuid, uuid, uuid),
  public.acknowledge_portrait_v2(uuid, uuid, uuid),
  private.create_adult_subject_invitation_v2(uuid, uuid, bytea, text, text, boolean, jsonb, jsonb),
  public.create_adult_subject_invitation_v2(uuid, uuid, bytea, text, text, boolean, jsonb, jsonb),
  private.respond_adult_subject_invitation_session_v2(text, text, text, uuid, uuid, jsonb),
  public.respond_adult_subject_invitation_session_v2(text, text, text, uuid, uuid, jsonb)
  to service_role;

notify pgrst, 'reload schema';
