-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It goes into the release after the follow-up, not the
-- follow-up's pinned set (owner decision, 23 October 2026). It follows
-- 20260928150000, whose shared adult acceptance body it patches in place.
-- =====================================================================
--
-- D-103, Path A (owner decision of 23 October 2026, "D-103: Path A
-- acceptance includes a typed name", and G8.5's "code to the register").
-- An adult who accepts an invitation through their own account also types
-- their name (adult-subject-confirmation-v1 path-a-account-required;
-- api.invitation-accept subjectArtifact.typedName), and the name is stored
-- encrypted the way Path B's e-signature stores it: the application
-- encrypts the trimmed name (src/lib/embryos/guards.ts#encryptedLiteral),
-- the database refuses anything shorter than 16 bytes, and the ciphertext
-- goes into consent_signatures.signing_name_encrypted. Until now
-- private.adult_subject_invitation_response_v1 wrote null there.
--
--   1. The shared acceptance body, private.adult_subject_invitation_response_v1,
--      is patched in place, md5-guarded with its exact reviewed ACL, one
--      anchor per patch, with each successor md5 and the unchanged ACL
--      asserted (55000 otherwise). Its account acceptance now requires the
--      typed name, read once from a transaction-local declaration
--      (inherit.adult_subject_signing_name) and cleared, the way the keyed
--      wrappers declare inherit.contact_alias_groups for the same body; it
--      writes the ciphertext on the signature; and its accepted event names
--      the route that now causes it, api.invitation-accept. Refusing and
--      deleting are unchanged. A caller that declares no name confirms
--      nothing: the rights-session door api.withdraw used
--      (respond_adult_subject_invitation_session_v1) and the mailed-token
--      door both answer 'unavailable' to 'confirm' from here on.
--   2. One service-only door, public.accept_adult_subject_invitation_v1
--      (over private.accept_adult_subject_invitation_v1), is the account
--      acceptance api.invitation-accept calls. It checks the ciphertext
--      first, then the account's own live auth session, locks the rights
--      session of the adult purpose, consumes the page's account-bound
--      one-time nonce (operation invitation_accept) before the invitation
--      is read, keys the account's address under every held contact
--      revision as the keyed session wrapper does, declares the name for
--      exactly one call of the shared body, clears it, and returns the
--      accepted subject's id, or null.
--
-- No table, column, constraint, statement key or wording changes. The
-- signing name is never plaintext here: it arrives and is stored as
-- ciphertext, and the declaration carries that ciphertext's hex.

do $predecessor$
begin
 if to_regprocedure('private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)') is null
  or not exists(select 1 from pg_proc p
   where p.oid='private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='824901bf47066e4e974bd90f2b1c7110'
   and p.proacl::text='{postgres=X/postgres}')
  -- What the door calls, each its reviewed body.
  or (select count(*) from pg_proc p join (values
    ('private.current_adult_subject_invitation_v1(uuid,uuid)','7fa7e1fe73fc4db2ecf9af8a7b26d265'),
    ('private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)','db5ce99583d6e1724eae8490eec6a9ef'),
    ('private.lock_invitation_transitions_v1()','3a28aeaf4bf736cbba89e3b209649557'),
    ('private.declare_contact_alias_groups_v1(jsonb)','60f413613a40bc0186e1edfc60518863'),
    ('private.resolve_hmac_set_v1(text,text,jsonb)','40d84663185bb3fe5fa5b67be4b364e3'),
    ('private.presented_contact_digest_v1(jsonb,text,bigint)','d0fef1099b2a5f5da60b43fc93a82437')
   ) as x(signature,body) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body)<>6
  or not exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='consent_signatures' and column_name='signing_name_encrypted' and data_type='bytea')
  or to_regprocedure('private.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea)') is not null
  or to_regprocedure('public.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea)') is not null then
  raise exception using errcode='55000',message='path a typed name prerequisite differs'; end if;
end;
$predecessor$;

-- 1. Guarded in-place patch of the shared acceptance body.
do $patch_path_a_typed_name$
declare item record;definition text;before_acl aclitem[];
begin
 for item in select * from (values
  -- The name's variable.
  (1,'private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)','824901bf47066e4e974bd90f2b1c7110',
   'd59e9ff8a73fc1793e6fbce77c26461f','{postgres=X/postgres}',
   $old$  v_terminal_status text;
begin$old$,
   $new$  v_terminal_status text;
  v_signing_name bytea;
begin$new$,
   'adult acceptance name variable'),
  -- Path A's acceptance requires the declared name, read once and cleared.
  (2,'private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)','d59e9ff8a73fc1793e6fbce77c26461f',
   '98b401c11269097e6c70f5e3e8f8b931','{postgres=X/postgres}',
   $old$    if v_draft.adult_flow <> 'path-a-own-account' then
      return 'unavailable';
    end if;
$old$,
   $new$    if v_draft.adult_flow <> 'path-a-own-account' then
      return 'unavailable';
    end if;

    -- 20261025400000 (D-103): Path A's acceptance includes the typed name,
    -- as ciphertext the application made the way it makes Path B's. Only
    -- private.accept_adult_subject_invitation_v1 declares it, for this one
    -- call; it is read once and cleared, so no other caller accepts.
    v_signing_name := pg_catalog.decode(nullif(pg_catalog.current_setting(
      'inherit.adult_subject_signing_name', true), ''), 'hex');
    perform pg_catalog.set_config('inherit.adult_subject_signing_name', '', true);
    if v_signing_name is null or octet_length(v_signing_name) < 16 then
      return 'unavailable';
    end if;
$new$,
   'adult acceptance name requirement'),
  -- The signature records the ciphertext.
  (3,'private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)','98b401c11269097e6c70f5e3e8f8b931',
   '28635d383f8a2988b08111a31f09fffd','{postgres=X/postgres}',
   $old$    insert into public.consent_signatures (
      artifact_key, artifact_version, artifact_body_sha256,
      signer_principal_id, signer_account_id, target_kind, target_id,
      purpose, statement_keys, jurisdiction_code, jurisdiction_revision,
      subject_binding_revision
    ) values (
      v_artifact.artifact_key, v_artifact.version, v_artifact.body_sha256,
      v_principal.id, p_account_id, 'subject', v_invitation.target_id,
      'adult-subject-account-acceptance',
      array['age-18-plus', 'mailbox-control', 'no-inviter-access',
        'identity-not-verified', 'revocable'],
      coalesce(v_profile.jurisdiction_code, 'ZZ'),
      v_profile.jurisdiction_revision, 2
    ) returning id into v_signature_id;$old$,
   $new$    insert into public.consent_signatures (
      artifact_key, artifact_version, artifact_body_sha256,
      signer_principal_id, signer_account_id, target_kind, target_id,
      purpose, statement_keys, signing_name_encrypted, jurisdiction_code,
      jurisdiction_revision, subject_binding_revision
    ) values (
      v_artifact.artifact_key, v_artifact.version, v_artifact.body_sha256,
      v_principal.id, p_account_id, 'subject', v_invitation.target_id,
      'adult-subject-account-acceptance',
      array['age-18-plus', 'mailbox-control', 'no-inviter-access',
        'identity-not-verified', 'revocable'],
      v_signing_name,
      coalesce(v_profile.jurisdiction_code, 'ZZ'),
      v_profile.jurisdiction_revision, 2
    ) returning id into v_signature_id;$new$,
   'adult acceptance signature'),
  -- The accepted event names the route that causes it.
  (4,'private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)','28635d383f8a2988b08111a31f09fffd',
   '99dfdec657617a2b4850f6632693ef51','{postgres=X/postgres}',
   $old$      'invitation.accepted', null, 'api.withdraw', 'accepted',$old$,
   $new$      'invitation.accepted', null, 'api.invitation-accept', 'accepted',$new$,
   'adult acceptance event route')
 ) as patch(ordinal,target,before_md5,after_md5,acl,old_fragment,new_fragment,label) order by ordinal loop
  select pg_get_functiondef(p.oid),p.proacl into definition,before_acl from pg_proc p
   where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.before_md5 and p.proacl::text=item.acl;
  if definition is null then raise exception using errcode='55000',message=item.label||' predecessor differs';end if;
  if (length(definition)-length(replace(definition,item.old_fragment,'')))/length(item.old_fragment)<>1 then
   raise exception using errcode='55000',message=item.label||' anchor differs';end if;
  execute replace(definition,item.old_fragment,item.new_fragment);
  if not exists(select 1 from pg_proc p where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.after_md5
    and p.proacl is not distinct from before_acl) then
   raise exception using errcode='55000',message=item.label||' successor differs';end if;
 end loop;
end;
$patch_path_a_typed_name$;

-- 2. The door api.invitation-accept calls for a Path A adult.
create function private.accept_adult_subject_invitation_v1(
  p_session_hash text,
  p_nonce text,
  p_account_id uuid,
  p_auth_session_id uuid,
  p_account_email_hmac_set jsonb,
  p_signing_name_ciphertext bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set jsonb;
  v_session public.rights_sessions%rowtype;
  v_invitation public.subject_invitations%rowtype;
  v_contact text;
  v_result text;
begin
  perform private.lock_invitation_transitions_v1();
  -- Path B's rule for a signing name: ciphertext of at least 16 bytes, never
  -- plaintext. Nothing is consumed or read for a request without one.
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
    or p_account_id is null or p_auth_session_id is null
    or p_account_email_hmac_set is null
    or p_signing_name_ciphertext is null or octet_length(p_signing_name_ciphertext) < 16
  then
    return null;
  end if;

  -- The account's own live auth session, as Path B's account branch requires.
  perform 1 from auth.sessions x
  where x.id = p_auth_session_id and x.user_id = p_account_id
    and (x.not_after is null or x.not_after > clock_timestamp());
  if not found then return null; end if;

  v_set := private.resolve_hmac_set_v1('contact', null, p_account_email_hmac_set);

  select rs.* into v_session
  from public.rights_sessions rs
  where rs.session_hash = p_session_hash
    and rs.purpose = 'adult-subject-invitation'
    and rs.target_kind = 'subject'
    and rs.status = 'active'
    and rs.expires_at > clock_timestamp()
  for update;
  if v_session.id is null then return null; end if;

  -- The page's one-time nonce, bound to this account, is consumed before the
  -- invitation is read, so one served review accepts at most once.
  perform private.consume_embryo_operation_nonce_v1(
    p_nonce, p_account_id, p_auth_session_id, 'invitation_accept',
    'rights_session', v_session.id
  );

  -- The address under every held contact revision, compared under the one
  -- the invitation was written with (the keyed session wrapper's rule).
  perform private.declare_contact_alias_groups_v1(jsonb_build_array(v_set));
  v_invitation := private.current_adult_subject_invitation_v1(
    v_session.token_hash_id, v_session.id
  );
  v_contact := private.presented_contact_digest_v1(
    v_set, v_invitation.email_hmac, v_invitation.email_hmac_key_revision
  );

  -- The name, for exactly this call of the shared acceptance body.
  perform pg_catalog.set_config('inherit.adult_subject_signing_name',
    pg_catalog.encode(p_signing_name_ciphertext, 'hex'), true);
  v_result := private.adult_subject_invitation_response_v1(
    v_session.token_hash_id, v_session.id, 'confirm', p_account_id, v_contact
  );
  perform pg_catalog.set_config('inherit.adult_subject_signing_name', '', true);
  perform private.declare_contact_alias_groups_v1('[]'::jsonb);

  if v_result is distinct from 'accepted' then return null; end if;
  return v_invitation.target_id;
end;
$$;
revoke all on function private.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea)
 from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea) to service_role;

create function public.accept_adult_subject_invitation_v1(
  p_session_hash text,
  p_nonce text,
  p_account_id uuid,
  p_auth_session_id uuid,
  p_account_email_hmac_set jsonb,
  p_signing_name_ciphertext bytea
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.accept_adult_subject_invitation_v1(
    p_session_hash, p_nonce, p_account_id, p_auth_session_id,
    p_account_email_hmac_set, p_signing_name_ciphertext);
$$;
revoke all on function public.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea) to service_role;

-- Postflight: the door and its wrapper carry exactly the reviewed ACL.
do $postflight$
begin
 if (select count(*) from pg_proc p where p.oid in (
    to_regprocedure('private.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea)'),
    to_regprocedure('public.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea)'))
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')<>2 then
  raise exception using errcode='55000',message='path a typed name door ACL differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
