-- api.future-person-claim: the public start of a Future Person claim.
--
-- future-person-claim-resolution-v1.publicIntake: every valid Record Key,
-- claimant Recovery Key or keyless request creates the same hash-only intake
-- session and the same opaque answer. Nothing here looks for a record, a
-- prior claimant or a candidate, so match, no match, too early and
-- ambiguous are indistinguishable by construction: the lookup happens later,
-- under a named human review, and never on this path.
--
-- future-person-claim-intake-privacy-v1: identity and contact fields arrive
-- already envelope-encrypted under a random claim-specific data key, and the
-- key itself arrives wrapped by the application's key. The database stores
-- no plaintext, holds no key, and has no decrypt path. A key mode stores only
-- the SHA-256 of the submitted key, the same hash the key tables hold, so a
-- later review can resolve it without the raw key ever persisting.
--
-- future-person.claim-intake-session-24h: 24 hours from creation, never
-- renewed; claim-session-api-v1 adds a 30-minute idle limit that never
-- extends the absolute one. A dead intake is deleted outright. Only live
-- intakes exist as rows, which is what every capacity count below reads.
--
-- api.future-person-claim.policy.abuseControls, all enforced here before any
-- intake row is written:
--   network    10 starts per 15 minutes, 40 per UTC day, and at most 3 live
--              intakes per normalized source network;
--   identifier 3 starts per UTC day and at most 1 live intake for the keyed
--              digest of the submitted key or normalized contact plus mode;
--   global     at most 500 live intake, documentary-review or keyless
--              notice-release cases; only intakes exist yet.
-- A refused start writes no intake, document, review, outbox or audit row
-- (public-capacity-limited-v1); only its bucket counters move.

create table private.future_person_claim_intakes (
  id uuid primary key default gen_random_uuid(),
  session_hash text not null unique check (session_hash ~ '^[0-9a-f]{64}$'),
  form_nonce_hash text not null unique check (form_nonce_hash ~ '^[0-9a-f]{64}$'),
  mode text not null check (mode in ('record-key', 'claimant-recovery-key', 'keyless-start')),
  key_hash text check (key_hash ~ '^[0-9a-f]{64}$'),
  identity_ciphertext bytea not null check (octet_length(identity_ciphertext) between 29 and 16384),
  wrapped_data_key bytea not null check (octet_length(wrapped_data_key) between 29 and 256),
  identifier_hmac text not null check (identifier_hmac ~ '^[0-9a-f]{64}$'),
  identifier_key_revision bigint not null check (identifier_key_revision > 0),
  network_hmac text not null check (network_hmac ~ '^[0-9a-f]{64}$'),
  network_key_revision bigint not null check (network_key_revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  last_active_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check ((mode = 'keyless-start') = (key_hash is null)),
  check (expires_at = created_at + interval '24 hours'),
  check (last_active_at >= created_at and last_active_at < expires_at)
);
create index future_person_claim_intakes_network_idx
  on private.future_person_claim_intakes (network_key_revision, network_hmac);
create index future_person_claim_intakes_identifier_idx
  on private.future_person_claim_intakes (identifier_key_revision, identifier_hmac);
create index future_person_claim_intakes_expiry_idx
  on private.future_person_claim_intakes (expires_at);
alter table private.future_person_claim_intakes enable row level security;
revoke all on private.future_person_claim_intakes from public, anon, authenticated, service_role;

insert into public.purge_target_stores (target_id, store_name, store_order)
values ('claim-review-working-packages', 'private.future_person_claim_intakes', 9);

-- A live intake: inside its absolute day and its 30-minute idle window.
create function private.claim_intake_live_v1(i private.future_person_claim_intakes)
returns boolean language sql stable security invoker set search_path = '' as $$
  select i.expires_at > clock_timestamp()
    and i.last_active_at > clock_timestamp() - interval '30 minutes';
$$;
revoke all on function private.claim_intake_live_v1(private.future_person_claim_intakes)
  from public, anon, authenticated, service_role;

-- {"<revision>": "<64 hex>"} restricted to the usable rate-limit revisions,
-- failing closed when one is missing (the same rule as every quota key).
create function private.claim_intake_digest_pairs_v1(p_digests jsonb)
returns table (key_revision bigint, digest text)
language sql stable security invoker set search_path = '' as $$
  select r.key::bigint, r.value
  from jsonb_each_text(private.resolve_hmac_set_v1('rate-limit', null, p_digests)) r;
$$;
revoke all on function private.claim_intake_digest_pairs_v1(jsonb)
  from public, anon, authenticated, service_role;

create function private.start_future_person_claim_v1(
  p_session_hash text,
  p_form_nonce_hash text,
  p_mode text,
  p_key_hash text,
  p_identity_ciphertext bytea,
  p_wrapped_data_key bytea,
  p_identifier_digests jsonb,
  p_network_digests jsonb
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_identifier_dimension text;
  v_identifier_keys jsonb := '{}'::jsonb;
  v_network_keys jsonb := '{}'::jsonb;
  v_pair record;
  v_active bigint := private.hmac_active_revision_v1('rate-limit');
  v_allowed boolean;
begin
  -- One writer at a time, so a capacity count and the row it admits commit
  -- together: the reservation is atomic.
  perform pg_advisory_xact_lock(1869509217, 20);

  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
    or p_form_nonce_hash is null or p_form_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_mode is null or p_mode not in ('record-key', 'claimant-recovery-key', 'keyless-start')
    or (p_mode = 'keyless-start') <> (p_key_hash is null)
    or (p_key_hash is not null and p_key_hash !~ '^[0-9a-f]{64}$')
    or p_identity_ciphertext is null or octet_length(p_identity_ciphertext) not between 29 and 16384
    or p_wrapped_data_key is null or octet_length(p_wrapped_data_key) not between 29 and 256
  then
    raise exception using errcode = '22023', message = 'claim intake invalid';
  end if;

  -- Buckets first, before anything else is read (securityRateLimitContract
  -- .decisionOrder). Each digest set must cover every usable revision.
  v_identifier_dimension := case when p_mode = 'keyless-start'
    then 'normalized-identifier' else 'token-or-key-hmac' end;
  for v_pair in select * from private.claim_intake_digest_pairs_v1(p_identifier_digests) loop
    v_identifier_keys := v_identifier_keys || jsonb_build_object(
      v_pair.key_revision::text, jsonb_build_object(v_identifier_dimension, v_pair.digest));
  end loop;
  for v_pair in select * from private.claim_intake_digest_pairs_v1(p_network_digests) loop
    v_network_keys := v_network_keys || jsonb_build_object(
      v_pair.key_revision::text, jsonb_build_object('source-network', v_pair.digest));
  end loop;

  v_allowed := private.consume_rate_limit_buckets_v1(
    'api.future-person-claim',
    '[{"dimension":"source-network","windowSeconds":900,"limit":10},
      {"dimension":"source-network","windowSeconds":86400,"limit":40}]'::jsonb,
    v_network_keys);
  v_allowed := private.consume_rate_limit_buckets_v1(
    'api.future-person-claim',
    jsonb_build_array(jsonb_build_object(
      'dimension', v_identifier_dimension, 'windowSeconds', 86400, 'limit', 3)),
    v_identifier_keys) and v_allowed;

  -- Live-session ceilings, counted over every usable revision's digest.
  if v_allowed and (
    (select count(*) from private.future_person_claim_intakes i
     where private.claim_intake_live_v1(i)
       and (i.network_key_revision, i.network_hmac) in (
         select * from private.claim_intake_digest_pairs_v1(p_network_digests))) >= 3
    or exists (
      select 1 from private.future_person_claim_intakes i
      where private.claim_intake_live_v1(i)
        and (i.identifier_key_revision, i.identifier_hmac) in (
          select * from private.claim_intake_digest_pairs_v1(p_identifier_digests)))
    or (select count(*) from private.future_person_claim_intakes i
        where private.claim_intake_live_v1(i)) >= 500
  ) then
    v_allowed := false;
  end if;

  if not v_allowed then
    return 'capacity_limited';
  end if;

  -- A replayed form nonce is refused, never answered with a second session.
  if exists (select 1 from private.future_person_claim_intakes where form_nonce_hash = p_form_nonce_hash)
    or exists (select 1 from private.future_person_claim_intakes where session_hash = p_session_hash)
  then
    raise exception using errcode = '23505', message = 'claim form already used';
  end if;

  insert into private.future_person_claim_intakes (
    session_hash, form_nonce_hash, mode, key_hash, identity_ciphertext, wrapped_data_key,
    identifier_hmac, identifier_key_revision, network_hmac, network_key_revision,
    created_at, last_active_at, expires_at
  )
  select p_session_hash, p_form_nonce_hash, p_mode, p_key_hash, p_identity_ciphertext,
    p_wrapped_data_key,
    (select digest from private.claim_intake_digest_pairs_v1(p_identifier_digests) where key_revision = v_active),
    v_active,
    (select digest from private.claim_intake_digest_pairs_v1(p_network_digests) where key_revision = v_active),
    v_active,
    now_at, now_at, now_at + interval '24 hours'
  from (select clock_timestamp() as now_at) t;

  -- The ledger learns that a claim started, and nothing about which kind.
  perform private.append_legal_audit_event(
    'claim.intake.started', null, 'api.future-person-claim', 'accepted', '{}'::jsonb);
  return 'received';
end;
$$;
revoke all on function private.start_future_person_claim_v1(
  text, text, text, text, bytea, bytea, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.start_future_person_claim_v1(
  text, text, text, text, bytea, bytea, jsonb, jsonb
) to service_role;

create function public.start_future_person_claim_v1(
  p_session_hash text,
  p_form_nonce_hash text,
  p_mode text,
  p_key_hash text,
  p_identity_ciphertext bytea,
  p_wrapped_data_key bytea,
  p_identifier_digests jsonb,
  p_network_digests jsonb
)
returns text language sql security invoker set search_path = '' as $$
  select private.start_future_person_claim_v1(
    p_session_hash, p_form_nonce_hash, p_mode, p_key_hash, p_identity_ciphertext,
    p_wrapped_data_key, p_identifier_digests, p_network_digests);
$$;
revoke all on function public.start_future_person_claim_v1(
  text, text, text, text, bytea, bytea, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.start_future_person_claim_v1(
  text, text, text, text, bytea, bytea, jsonb, jsonb
) to service_role;

-- future-person.claim-intake-session-24h: delete every intake past its
-- absolute day or its idle window. Deleting the row destroys the wrapped data
-- key with the ciphertext, so nothing it held can be read again.
create function private.purge_future_person_claim_intakes_v1()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  perform pg_advisory_xact_lock(1869509217, 20);
  delete from private.future_person_claim_intakes i where not private.claim_intake_live_v1(i);
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform private.append_legal_audit_event(
      'claim.intake.expired', null, 'jobs.retention', 'purged',
      jsonb_build_object('count', v_count));
  end if;
  return v_count;
end;
$$;
revoke all on function private.purge_future_person_claim_intakes_v1()
  from public, anon, authenticated, service_role;
grant execute on function private.purge_future_person_claim_intakes_v1() to service_role;

create function public.purge_future_person_claim_intakes_v1()
returns integer language sql security invoker set search_path = '' as $$
  select private.purge_future_person_claim_intakes_v1();
$$;
revoke all on function public.purge_future_person_claim_intakes_v1()
  from public, anon, authenticated;
grant execute on function public.purge_future_person_claim_intakes_v1() to service_role;

-- secretRotation: a rate-limit revision protects an unexpired intake as it
-- protects an unexpired bucket. The live-session ceilings match an intake by
-- the digest it was written under, so that revision must not retire while the
-- intake could still be matched; otherwise a rotation would quietly lift the
-- one-live-intake limit for the rest of the day. The contact branch is
-- unchanged from 20260928130000_hmac_keyring.sql.
create or replace function private.hmac_key_revision_in_use_v1(p_keyring text, p_revision bigint)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case p_keyring
    when 'rate-limit' then exists (
      select 1 from public.rate_limit_hmac_buckets b
      where b.hmac_key_revision = p_revision and b.expires_at > clock_timestamp())
      or exists (
        select 1 from private.future_person_claim_intakes i
        where p_revision in (i.network_key_revision, i.identifier_key_revision)
          and i.expires_at > clock_timestamp())
    else
      exists (
        select 1 from public.contact_refusal_bars b
        where b.hmac_key_revision = p_revision and b.expires_at > clock_timestamp())
      or exists (
        select 1 from public.invitation_refusal_hmacs b
        where b.hmac_key_revision = p_revision and b.expires_at > clock_timestamp())
      or exists (
        select 1 from public.subject_invitations i
        where i.email_hmac_key_revision = p_revision and i.status = 'pending')
      or exists (
        select 1 from public.contact_hmac_indexes h
        join public.encrypted_contact_references e on e.id = h.contact_reference_id
        join public.subject_principals sp on sp.id = e.principal_id
        where h.hmac_key_revision = p_revision and h.status = 'current'
          and h.expires_at > clock_timestamp() and e.status = 'current'
          and sp.status = 'pending')
      or exists (
        select 1 from public.subject_control_refusal_authorities a
        join public.encrypted_contact_references e on e.principal_id = a.principal_id
        where a.status = 'current' and e.status = 'current'
          and e.key_revision = p_revision)
  end;
$$;
revoke all on function private.hmac_key_revision_in_use_v1(text, bigint)
  from public, anon, authenticated, service_role;

-- The live intake a claim cookie names, or nothing. For the claim-session
-- routes that follow (documents, completion); never granted to an API role.
create function private.current_claim_intake_v1(p_session_hash text)
returns private.future_person_claim_intakes
language sql stable security invoker set search_path = '' as $$
  select i.* from private.future_person_claim_intakes i
  where i.session_hash = p_session_hash and private.claim_intake_live_v1(i);
$$;
revoke all on function private.current_claim_intake_v1(text)
  from public, anon, authenticated, service_role;
