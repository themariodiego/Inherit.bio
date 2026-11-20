-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It joins release 4 after 20261119110000, whose
-- successor core it calls unchanged, and replaces the three Path A doors
-- that 20260928130100 (the keyed body and its public door) and
-- 20261023120000 (the nonce door) created.
-- =====================================================================
--
-- D-139. Path A's optional invitation note is sealed by the application and
-- written in the transaction that creates the invitation. The register's
-- api.subject-drafts says the note "is envelope-encrypted and may flow only
-- to that invitation template" (policy.transaction) and that its plaintext
-- "exists only in bounded request and mail-worker memory" (policy.contact);
-- by the owner's rule of 19 November 2026 engineering codes to the register.
-- The route used to write the plain note into mail_outbox.template_payload
-- after this transaction had committed, without reading the write's error
-- and only while the row was still queued, so a worker that claimed the row
-- first sent the invitation without it.
--
--   1. The table. Under ACCESS EXCLUSIVE on public.mail_outbox, the
--      migration refuses (55000, writing nothing) while any queued or
--      claimed invitation row still holds a plain note: dropping it would
--      send that invitation without its note, and the database has no key
--      to seal it. A plain note on a row that can no longer be sent
--      (submitted, delivered, failed, invalidated or expired) is removed:
--      nothing reads it again, and docs/retention.md's
--      mail.resend-provider-payload-30d keeps no content after provider
--      acceptance. Then mail_outbox_adult_invitation_note_sealed: an
--      adult-subject-invitation row's payload holds only `request` (Path B)
--      or `noteEnvelope` (Path A), never both, and an envelope is exactly
--      { version 1, idempotencyKey, wrappedKey, ciphertext }: the key is the
--      row's own idempotency key, the wrapped key 144 hex digits, the sealed
--      note 29 to 1,528 bytes of hex. The database cannot decrypt; it holds
--      the shape, the size and the binding, and never a plain `note`.
--   2. Retention. A trigger removes the envelope when the row leaves queued
--      and claimed, in the transaction that moves it: complete_mail_attempt
--      on provider acceptance (the worker's own transaction), and every
--      failure, expiry or invalidation. No path returns such a row to the
--      queue, so nothing a person sees changes.
--   3. The doors. The keyed body, its public door and the nonce door each
--      gain one trailing parameter, p_note_envelope jsonb default null, so a
--      caller that does not send it (the deployed route, every suite) is
--      served exactly as before. The keyed body refuses a malformed envelope
--      (22023) before it counts or writes anything, on every path. On a new
--      invitation it writes { noteEnvelope } onto the invitation's queued
--      mail in the same transaction, and refuses (55000) if that row is not
--      there to take it; a replay of the key, a barred address and an
--      exhausted quota write no note, so a replay keeps the first one.
--
-- The core (private.create_adult_subject_invitation_core_v1) is called
-- unchanged and pinned to the successor 20261119110000 left. The application
-- seals with the house document envelope bound to the template, the purpose
-- and this idempotency key, and the mail worker opens it only after checking
-- the key against the provider attempt key the claim returns,
-- private.mail_provider_attempt_key_v1, whose result the predecessor and
-- postflight blocks pin. No wording, column, grant scope or other
-- constraint changes.

do $predecessor$
begin
 -- Each door its reviewed body and ACL, and the core as 20261119110000 left
 -- it. Distinct signatures are counted, so no body can stand in for another.
 if (select count(distinct x.signature) from pg_proc p join (values
    ('private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)','72ea3d6e8b41bfe74d8645259f7cfad7',
     '{postgres=X/postgres}'),
    ('private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb)','20bdaa2fe113d92c696af0112fe072b5',
     '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb)','160df78ea5b4bce3a1680fa84cb2cec9',
     '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz)',
     '9819f58145dbbacb8926b651f983c8c2','{postgres=X/postgres,service_role=X/postgres}')
   ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
    and p.proacl::text=x.acl)<>4
  -- The provider attempt key the worker checks an envelope's key against.
  or private.mail_provider_attempt_key_v1(jsonb_populate_record(null::public.mail_outbox,jsonb_build_object(
    'idempotency_key',repeat('a',64),'token_purpose','adult-subject-invitation','attempt_count',3)))
   is distinct from '6f1e8bd33056fe66d4fcfd2b65ab888dae730da76626fa0bca5399fe944c4517'
  -- Nothing this migration creates exists yet.
  or to_regprocedure('private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb,jsonb)') is not null
  or to_regprocedure('public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb,jsonb)') is not null
  or to_regprocedure('public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz,jsonb)')
   is not null
  or to_regprocedure('private.clear_adult_invitation_note_envelope_v1()') is not null
  or exists(select 1 from pg_constraint where conrelid='public.mail_outbox'::regclass
   and conname='mail_outbox_adult_invitation_note_sealed')
  or exists(select 1 from pg_trigger where tgrelid='public.mail_outbox'::regclass
   and tgname='clear_adult_invitation_note_envelope') then
  raise exception using errcode='55000',message='sealed invitation note prerequisite differs'; end if;
end;
$predecessor$;

-- 1. No plain note survives, and the table refuses one from now on. The lock
-- comes first, so the refusal and the cleanup read exactly the rows the
-- check then validates.
do $seal_table$
begin
 lock table public.mail_outbox in access exclusive mode;
 if exists(select 1 from public.mail_outbox where template_id='adult-subject-invitation'
   and state in ('queued','claimed') and template_payload ? 'note') then
  raise exception using errcode='55000',message='plain invitation note on a sendable row'; end if;
 update public.mail_outbox set template_payload=template_payload-'note'
  where template_id='adult-subject-invitation' and state not in ('queued','claimed') and template_payload ? 'note';
 alter table public.mail_outbox add constraint mail_outbox_adult_invitation_note_sealed check (
  template_id<>'adult-subject-invitation'
  or coalesce(template_payload-array['request','noteEnvelope']='{}'::jsonb
   and not (template_payload ? 'request' and template_payload ? 'noteEnvelope')
   and (not template_payload ? 'noteEnvelope' or (
    jsonb_typeof(template_payload->'noteEnvelope')='object'
    and (template_payload->'noteEnvelope') ?& array['version','idempotencyKey','wrappedKey','ciphertext']
    and (template_payload->'noteEnvelope')-array['version','idempotencyKey','wrappedKey','ciphertext']='{}'::jsonb
    and template_payload->'noteEnvelope'->'version'='1'::jsonb
    and template_payload->'noteEnvelope'->'idempotencyKey'=to_jsonb(idempotency_key)
    and jsonb_typeof(template_payload->'noteEnvelope'->'wrappedKey')='string'
    and template_payload->'noteEnvelope'->>'wrappedKey' ~ '^[0-9a-f]{144}$'
    and jsonb_typeof(template_payload->'noteEnvelope'->'ciphertext')='string'
    and template_payload->'noteEnvelope'->>'ciphertext' ~ '^[0-9a-f]+$'
    and length(template_payload->'noteEnvelope'->>'ciphertext') between 58 and 3056
    and length(template_payload->'noteEnvelope'->>'ciphertext')%2=0)),false));
end;
$seal_table$;

-- 2. The envelope lives exactly as long as its mail can still be sent.
create function private.clear_adult_invitation_note_envelope_v1()
returns trigger language plpgsql set search_path='' as $$
begin
 new.template_payload:=new.template_payload-'noteEnvelope';
 return new;
end $$;
revoke all on function private.clear_adult_invitation_note_envelope_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;
create trigger clear_adult_invitation_note_envelope before update on public.mail_outbox for each row
 when (new.template_id='adult-subject-invitation' and new.state not in ('queued','claimed')
  and new.template_payload ? 'noteEnvelope')
 execute function private.clear_adult_invitation_note_envelope_v1();

-- 3. The three doors, each with one trailing defaulted parameter. The old
-- signatures go first; nothing else in the database calls them by OID.
drop function public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz);
drop function public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb);
drop function private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb);

-- The keyed body: 20260928130100's, with the envelope refused or recorded.
create function private.create_adult_subject_invitation_keyed_v1(
  p_account_id uuid,
  p_contact_ciphertext bytea,
  p_contact_hmac text,
  p_idempotency_key text,
  p_test_jurisdiction boolean,
  p_contact_hmac_set jsonb,
  p_quota_keys jsonb,
  p_note_envelope jsonb default null
)
returns table (invitation_id uuid, subject_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_set jsonb;
  v_replay boolean;
  v_invitation_id uuid;
  v_subject_id uuid;
  v_expires_at timestamptz;
begin
  perform private.lock_invitation_transitions_v1();
  -- D-139: only a well-formed envelope of bounded size, bound to this key,
  -- and never plain text; refused before anything is counted or written.
  -- The same shape as mail_outbox_adult_invitation_note_sealed.
  if p_note_envelope is not null and not coalesce(
    jsonb_typeof(p_note_envelope)='object'
    and p_note_envelope ?& array['version','idempotencyKey','wrappedKey','ciphertext']
    and p_note_envelope-array['version','idempotencyKey','wrappedKey','ciphertext']='{}'::jsonb
    and p_note_envelope->'version'='1'::jsonb
    and p_note_envelope->'idempotencyKey'=to_jsonb(p_idempotency_key)
    and jsonb_typeof(p_note_envelope->'wrappedKey')='string'
    and p_note_envelope->>'wrappedKey' ~ '^[0-9a-f]{144}$'
    and jsonb_typeof(p_note_envelope->'ciphertext')='string'
    and p_note_envelope->>'ciphertext' ~ '^[0-9a-f]+$'
    and length(p_note_envelope->>'ciphertext') between 58 and 3056
    and length(p_note_envelope->>'ciphertext')%2=0,false) then
    raise exception using errcode = '22023', message = 'adult invitation note invalid';
  end if;
  if not private.consume_invitation_attempt_quota_v1(p_quota_keys) then
    -- The same shape a barred address returns: no subject, draft or mail.
    return query select null::uuid, null::uuid, clock_timestamp() + interval '30 days';
    return;
  end if;

  v_set := private.resolve_hmac_set_v1('contact', p_contact_hmac, p_contact_hmac_set);
  if v_set is not null then
    perform private.declare_contact_alias_groups_v1(jsonb_build_array(v_set));
  end if;

  -- A replay of the key returns its invitation and writes nothing, so it
  -- keeps the note, or no note, that the first request recorded.
  v_replay := exists (
    select 1 from public.mail_outbox m
    where m.idempotency_key = p_idempotency_key
      and m.template_id = 'adult-subject-invitation'
      and m.target_kind = 'subject_invitation');

  select c.invitation_id, c.subject_id, c.expires_at
    into v_invitation_id, v_subject_id, v_expires_at
  from private.create_adult_subject_invitation_core_v1(
    p_account_id, p_contact_ciphertext,
    coalesce(v_set ->> private.hmac_active_revision_v1('contact')::text, p_contact_hmac),
    p_idempotency_key, p_test_jurisdiction) c;

  -- The new invitation's mail, still queued and uncommitted, takes the note
  -- in this transaction; if it is not there to take it, nothing commits.
  if p_note_envelope is not null and not v_replay and v_invitation_id is not null then
    update public.mail_outbox m
    set template_payload = jsonb_build_object('noteEnvelope', p_note_envelope)
    where m.idempotency_key = p_idempotency_key
      and m.template_id = 'adult-subject-invitation'
      and m.target_kind = 'subject_invitation'
      and m.target_id = v_invitation_id
      and m.state = 'queued'
      and m.template_payload = '{}'::jsonb;
    if not found then
      raise exception using errcode = '55000', message = 'adult invitation note unrecorded';
    end if;
  end if;
  perform private.declare_contact_alias_groups_v1('[]'::jsonb);
  return query select v_invitation_id, v_subject_id, v_expires_at;
end;
$$;
revoke all on function private.create_adult_subject_invitation_keyed_v1(
  uuid, bytea, text, text, boolean, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role, inherit_upload_only;
grant execute on function private.create_adult_subject_invitation_keyed_v1(
  uuid, bytea, text, text, boolean, jsonb, jsonb, jsonb
) to service_role;

create function public.create_adult_subject_invitation_v1(
  p_account_id uuid,
  p_contact_ciphertext bytea,
  p_contact_hmac text,
  p_idempotency_key text,
  p_test_jurisdiction boolean,
  p_contact_hmac_set jsonb default null,
  p_quota_keys jsonb default null,
  p_note_envelope jsonb default null
)
returns table (invitation_id uuid, subject_id uuid, expires_at timestamptz)
language sql security invoker set search_path = '' as $$
  select * from private.create_adult_subject_invitation_keyed_v1(
    p_account_id, p_contact_ciphertext, p_contact_hmac, p_idempotency_key,
    p_test_jurisdiction, p_contact_hmac_set, p_quota_keys, p_note_envelope);
$$;
revoke all on function public.create_adult_subject_invitation_v1(
  uuid, bytea, text, text, boolean, jsonb, jsonb, jsonb
) from public, anon, authenticated, inherit_upload_only;
grant execute on function public.create_adult_subject_invitation_v1(
  uuid, bytea, text, text, boolean, jsonb, jsonb, jsonb
) to service_role;

create function public.create_adult_subject_invitation_with_nonce_v1(p_account_id uuid,p_session_id uuid,
 p_contact_ciphertext bytea,p_contact_hmac text,p_idempotency_key text,p_test_jurisdiction boolean,
 p_contact_hmac_set jsonb,p_quota_keys jsonb,p_nonce_hash text,p_nonce_expires_at timestamptz,
 p_note_envelope jsonb default null)
returns table(invitation_id uuid,subject_id uuid,expires_at timestamptz) language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'adult_invitation_create',p_nonce_hash,p_nonce_expires_at);
 return query select x.invitation_id,x.subject_id,x.expires_at from public.create_adult_subject_invitation_v1(p_account_id,
  p_contact_ciphertext,p_contact_hmac,p_idempotency_key,p_test_jurisdiction,p_contact_hmac_set,p_quota_keys,p_note_envelope) x;
end $$;
revoke all on function public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz,jsonb)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz,jsonb)
 to service_role;

-- Postflight: the three doors and the trigger function are their reviewed
-- bodies with exactly their ACLs, the old signatures are gone, the core and
-- the provider attempt key are unchanged, the check and the trigger read as
-- written, and no invitation row holds a plain note.
do $postflight$
begin
 if (select count(distinct x.signature) from pg_proc p join (values
    ('private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)','72ea3d6e8b41bfe74d8645259f7cfad7',
     '{postgres=X/postgres}'),
    ('private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb,jsonb)','d52340218a6b537108fe5a607babc934',
     '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb,jsonb)','24cfb0d901b6dad3b06bed8589dea711',
     '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz,jsonb)',
     'de553b25718a0ef23dba647af8365714','{postgres=X/postgres,service_role=X/postgres}'),
    ('private.clear_adult_invitation_note_envelope_v1()','a5755b564addae646189029029729b3c','{postgres=X/postgres}')
   ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
    and p.proacl::text=x.acl)<>5
  or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname in ('create_adult_subject_invitation_keyed_v1',
     'create_adult_subject_invitation_v1','create_adult_subject_invitation_with_nonce_v1'))<>3
  or private.mail_provider_attempt_key_v1(jsonb_populate_record(null::public.mail_outbox,jsonb_build_object(
    'idempotency_key',repeat('a',64),'token_purpose','adult-subject-invitation','attempt_count',3)))
   is distinct from '6f1e8bd33056fe66d4fcfd2b65ab888dae730da76626fa0bca5399fe944c4517'
  or (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid='public.mail_outbox'::regclass
    and c.conname='mail_outbox_adult_invitation_note_sealed' and c.contype='c' and c.convalidated)
   is distinct from '7dad1be68d490a62ad8bb13acc8ec54b'
  or (select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid='public.mail_outbox'::regclass
    and t.tgname='clear_adult_invitation_note_envelope' and t.tgenabled='O')
   is distinct from 'CREATE TRIGGER clear_adult_invitation_note_envelope BEFORE UPDATE ON public.mail_outbox FOR EACH ROW '
    ||'WHEN (((new.template_id = ''adult-subject-invitation''::text) AND (new.state <> ALL (ARRAY[''queued''::text, '
    ||'''claimed''::text])) AND (new.template_payload ? ''noteEnvelope''::text))) '
    ||'EXECUTE FUNCTION private.clear_adult_invitation_note_envelope_v1()'
  or exists(select 1 from public.mail_outbox where template_id='adult-subject-invitation' and template_payload ? 'note') then
  raise exception using errcode='55000',message='sealed invitation note successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
