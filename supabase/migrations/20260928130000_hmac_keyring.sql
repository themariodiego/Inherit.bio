-- Versioned keyrings for the keyed digests the database matches but never
-- computes. The secrets stay outside the database (the application derives
-- every digest); this table only records which key revisions a digest may be
-- presented under, and which one new rows are written under.
--
--  * contact    lifecycleDispositionContracts.global-contact-refusal-bar-v1
--               .barKeyring: every issuance, activation, mail and refusal
--               transaction treats a match under any still-usable revision as
--               the same contact; an old revision cannot retire while a live
--               bar, pending invitation or pending contact still depends on
--               it; rotation never opens an invitation gap.
--  * rate-limit securityRateLimitContract.secretRotation: new buckets use only
--               the current revision; an unexpired bucket under an older
--               revision keeps counting until its fixed purge; the old
--               revision retires only after its last bucket's purge time.
--
-- Revision 1 of the contact keyring is the digest the application already
-- computes (the existing `contact-email-v1` derivation), so this migration
-- changes no stored contact value; revision 1 of the rate-limit keyring is
-- derived the same way under its own context. Until an operator rotates a
-- keyring, a single bare digest remains a complete set; after rotation it is
-- refused.

create table private.hmac_key_versions (
  keyring text not null check (keyring in ('contact', 'rate-limit')),
  key_revision bigint not null check (key_revision between 1 and 999999),
  state text not null check (state in ('active', 'retiring', 'retired')),
  activated_at timestamptz not null default clock_timestamp(),
  retiring_since timestamptz,
  retired_at timestamptz,
  primary key (keyring, key_revision),
  check ((state = 'active') = (retiring_since is null)),
  check ((state = 'retired') = (retired_at is not null)),
  check (retired_at is null or retired_at >= retiring_since)
);
create unique index hmac_key_versions_one_active
  on private.hmac_key_versions (keyring) where state = 'active';
alter table private.hmac_key_versions enable row level security;
revoke all on private.hmac_key_versions from public, anon, authenticated, service_role;
insert into private.hmac_key_versions (keyring, key_revision, state)
values ('contact', 1, 'active'), ('rate-limit', 1, 'active');

-- The revisions a lookup may still use: the active one and every retiring one.
create function private.hmac_lookup_revisions_v1(p_keyring text)
returns bigint[] language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(v.key_revision order by v.key_revision), '{}'::bigint[])
  from private.hmac_key_versions v
  where v.keyring = p_keyring and v.state in ('active', 'retiring');
$$;
revoke all on function private.hmac_lookup_revisions_v1(text)
  from public, anon, authenticated, service_role;

create function private.hmac_active_revision_v1(p_keyring text)
returns bigint language sql stable security invoker set search_path = '' as $$
  select v.key_revision from private.hmac_key_versions v
  where v.keyring = p_keyring and v.state = 'active';
$$;
revoke all on function private.hmac_active_revision_v1(text)
  from public, anon, authenticated, service_role;

-- Restrict a presented digest set to the revisions a lookup may use, as
-- {"<revision>": "<64 hex>"}. Every usable revision must be present: a caller
-- missing one would silently skip a bar written under it, which is the gap
-- rotation must never open, so that is a failure, not a smaller match.
-- Retired and not-yet-rotated revisions are dropped and can never match.
--
-- p_set null is the pre-keyring call shape: one bare digest, which is
-- revision 1 by construction. It is a complete set only while revision 1 is
-- the one usable revision, so after the first rotation it is refused, and a
-- digest under a retired key can never be presented as a current one. A
-- missing or malformed bare digest returns null: the authority body that
-- receives it keeps its own refusal for that case.
create function private.resolve_hmac_set_v1(p_keyring text, p_legacy text, p_set jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_revisions bigint[] := private.hmac_lookup_revisions_v1(p_keyring);
  v_result jsonb := '{}'::jsonb;
  v_revision bigint;
  v_value text;
begin
  if p_set is null then
    if p_legacy is null or p_legacy !~ '^[0-9a-f]{64}$' then
      return null;
    end if;
    if v_revisions <> array[1::bigint] then
      raise exception using errcode = '55000', message = 'keyed digest set required';
    end if;
    return jsonb_build_object('1', p_legacy);
  end if;

  if jsonb_typeof(p_set) <> 'object'
    or (select count(*) from jsonb_object_keys(p_set)) not between 1 and 16
    or exists (
      select 1 from jsonb_each(p_set) e
      where e.key !~ '^[1-9][0-9]{0,5}$'
        or jsonb_typeof(e.value) <> 'string'
        or (e.value #>> '{}') !~ '^[0-9a-f]{64}$'
    )
    or (p_legacy is not null and p_legacy is distinct from p_set ->> '1')
  then
    raise exception using errcode = '22023', message = 'keyed digest set invalid';
  end if;

  foreach v_revision in array v_revisions loop
    v_value := p_set ->> v_revision::text;
    if v_value is null then
      raise exception using errcode = '55000', message = 'keyed digest set incomplete';
    end if;
    v_result := v_result || jsonb_build_object(v_revision::text, v_value);
  end loop;
  -- Two revisions yielding one digest means one secret is configured twice.
  if (select count(distinct e.value) from jsonb_each_text(v_result) e)
    <> (select count(*) from jsonb_each_text(v_result)) then
    raise exception using errcode = '22023', message = 'keyed digest set invalid';
  end if;
  return v_result;
end;
$$;
revoke all on function private.resolve_hmac_set_v1(text, text, jsonb)
  from public, anon, authenticated, service_role;

-- A resolved contact set is one address under several key revisions, all
-- derived from the same normalized address in the same request. Declaring the
-- sets for the current transaction only (set_config local) lets the existing
-- authority bodies treat every member as the same contact, and stamps each
-- row they write with the revision of the digest it stores. Nothing persists:
-- the setting ends with the transaction.
create function private.declare_contact_alias_groups_v1(p_groups jsonb)
returns void language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_map jsonb := '{}'::jsonb;
  v_group jsonb;
  v_index integer := 0;
  v_entry record;
begin
  if jsonb_typeof(p_groups) <> 'array' then
    raise exception using errcode = '22023', message = 'contact groups invalid';
  end if;
  for v_group in select g.value from jsonb_array_elements(p_groups) g loop
    v_index := v_index + 1;
    for v_entry in select e.key, e.value from jsonb_each_text(v_group) e loop
      if not v_map ? v_entry.value then
        v_map := v_map || jsonb_build_object(
          v_entry.value, jsonb_build_array(v_index, v_entry.key::bigint));
      end if;
    end loop;
  end loop;
  perform set_config('inherit.contact_alias_groups', v_map::text, true);
end;
$$;
revoke all on function private.declare_contact_alias_groups_v1(jsonb)
  from public, anon, authenticated, service_role;

create function private.declared_contact_aliases_v1()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case
    when coalesce(current_setting('inherit.contact_alias_groups', true), '') = ''
      then '{}'::jsonb
    else current_setting('inherit.contact_alias_groups', true)::jsonb
  end;
$$;
revoke all on function private.declared_contact_aliases_v1()
  from public, anon, authenticated, service_role;

-- The existing alias walk, plus the members of a set declared in this
-- transaction. Bars and index edges are walked whatever their revision's
-- state: an old digest can only ever add a match, never remove one, so a
-- retired revision can make the walk stricter but never weaker.
create or replace function private.invitation_contact_aliases_v1(p_hmac text)
returns text[] language sql stable security invoker set search_path = '' as $$
  with recursive declared(hmac, grp) as (
    select d.key, (d.value ->> 0)::integer
    from jsonb_each(private.declared_contact_aliases_v1()) d
  ), edges(a, b) as (
    select e.contact_hmac, h.contact_hmac
    from public.encrypted_contact_references e
    join public.contact_hmac_indexes h on h.contact_reference_id = e.id
    where h.status = 'current' and h.expires_at > statement_timestamp()
    union
    select a.contact_hmac, b.contact_hmac
    from public.contact_refusal_bars a
    join public.contact_refusal_bars b
      on b.target_kind = a.target_kind and b.target_id = a.target_id
      and b.refusal_revision = a.refusal_revision
    where a.expires_at > statement_timestamp() and b.expires_at > statement_timestamp()
    union
    select x.hmac, y.hmac
    from declared x join declared y on y.grp = x.grp and y.hmac <> x.hmac
  ), aliases(hmac) as (
    select p_hmac
    union
    select case when e.a = a.hmac then e.b else e.a end
    from aliases a join edges e on e.a = a.hmac or e.b = a.hmac
  )
  select array_agg(hmac order by hmac) from aliases;
$$;

-- Every stored contact digest carries the key revision it was computed under,
-- so a revision can be retired only when nothing still depends on it.
alter table public.subject_invitations
  add column email_hmac_key_revision bigint not null default 1
    check (email_hmac_key_revision > 0);
alter table public.subject_invitations alter column email_hmac_key_revision drop default;
alter table public.contact_refusal_bars
  add column hmac_key_revision bigint not null default 1 check (hmac_key_revision > 0);
alter table public.contact_refusal_bars alter column hmac_key_revision drop default;
alter table public.invitation_refusal_hmacs
  add column hmac_key_revision bigint not null default 1 check (hmac_key_revision > 0);
alter table public.invitation_refusal_hmacs alter column hmac_key_revision drop default;

create index contact_hmac_indexes_hmac_idx on public.contact_hmac_indexes (contact_hmac);
create index encrypted_contact_references_hmac_idx
  on public.encrypted_contact_references (contact_hmac);
create index subject_invitations_email_hmac_revision_idx
  on public.subject_invitations (email_hmac_key_revision) where status = 'pending';
create index contact_refusal_bars_revision_idx
  on public.contact_refusal_bars (hmac_key_revision, expires_at);
create index invitation_refusal_hmacs_revision_idx
  on public.invitation_refusal_hmacs (hmac_key_revision, expires_at);

-- The revision of a stored digest: the set declared in this transaction, or
-- any row that already records the same digest. A digest is unique to its
-- key, so every source agrees. Before the first rotation everything is
-- revision 1; after it an unknown digest is refused rather than guessed.
create function private.contact_hmac_key_revision_v1(p_hmac text)
returns bigint language plpgsql stable security invoker set search_path = '' as $$
declare
  v_revision bigint := (private.declared_contact_aliases_v1() -> p_hmac ->> 1)::bigint;
begin
  if v_revision is null then
    select h.hmac_key_revision into v_revision
    from public.contact_hmac_indexes h where h.contact_hmac = p_hmac limit 1;
  end if;
  if v_revision is null then
    select e.key_revision into v_revision
    from public.encrypted_contact_references e where e.contact_hmac = p_hmac limit 1;
  end if;
  if v_revision is null then
    select i.email_hmac_key_revision into v_revision
    from public.subject_invitations i where i.email_hmac = p_hmac limit 1;
  end if;
  if v_revision is null then
    select b.hmac_key_revision into v_revision
    from public.contact_refusal_bars b where b.contact_hmac = p_hmac limit 1;
  end if;
  if v_revision is null then
    select b.hmac_key_revision into v_revision
    from public.invitation_refusal_hmacs b where b.email_hmac = p_hmac;
  end if;
  if v_revision is null and not exists (
    select 1 from private.hmac_key_versions v
    where v.keyring = 'contact' and v.key_revision > 1
  ) then
    v_revision := 1;
  end if;
  if v_revision is null then
    raise exception using errcode = '55000', message = 'contact key revision unresolved';
  end if;
  return v_revision;
end;
$$;
revoke all on function private.contact_hmac_key_revision_v1(text)
  from public, anon, authenticated, service_role;

create function private.stamp_contact_hmac_revision_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'subject_invitations' then
    if new.email_hmac_key_revision is null then
      new.email_hmac_key_revision := private.contact_hmac_key_revision_v1(new.email_hmac);
    end if;
  elsif tg_table_name = 'contact_refusal_bars' then
    if new.hmac_key_revision is null then
      new.hmac_key_revision := private.contact_hmac_key_revision_v1(new.contact_hmac);
    end if;
  elsif tg_table_name = 'invitation_refusal_hmacs' then
    if new.hmac_key_revision is null then
      new.hmac_key_revision := private.contact_hmac_key_revision_v1(new.email_hmac);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_contact_hmac_revision_v1()
  from public, anon, authenticated, service_role;
create trigger subject_invitations_stamp_key_revision
  before insert on public.subject_invitations
  for each row execute function private.stamp_contact_hmac_revision_v1();
create trigger contact_refusal_bars_stamp_key_revision
  before insert on public.contact_refusal_bars
  for each row execute function private.stamp_contact_hmac_revision_v1();
create trigger invitation_refusal_hmacs_stamp_key_revision
  before insert on public.invitation_refusal_hmacs
  for each row execute function private.stamp_contact_hmac_revision_v1();

-- Contact references and their indexes are written by bodies that predate the
-- keyring and name revision 1. A digest from a declared set takes its real
-- revision instead; any other digest is the revision-1 digest those bodies
-- have always received.
create function private.stamp_declared_contact_revision_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_declared jsonb := private.declared_contact_aliases_v1() -> new.contact_hmac;
begin
  if v_declared is not null then
    if tg_table_name = 'encrypted_contact_references' then
      new.key_revision := (v_declared ->> 1)::bigint;
    else
      new.hmac_key_revision := (v_declared ->> 1)::bigint;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_declared_contact_revision_v1()
  from public, anon, authenticated, service_role;
create trigger encrypted_contact_references_stamp_key_revision
  before insert on public.encrypted_contact_references
  for each row execute function private.stamp_declared_contact_revision_v1();
create trigger contact_hmac_indexes_stamp_key_revision
  before insert on public.contact_hmac_indexes
  for each row execute function private.stamp_declared_contact_revision_v1();

-- A contact written from a declared set is indexed under every usable
-- revision of that set, with the same status and expiry, so a later refusal
-- that knows only the stored digest still reaches the other revisions.
create function private.link_declared_contact_aliases_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_map jsonb := private.declared_contact_aliases_v1();
begin
  if pg_trigger_depth() > 1 or not v_map ? new.contact_hmac then
    return null;
  end if;
  insert into public.contact_hmac_indexes (
    contact_reference_id, contact_hmac, hmac_key_revision, status, expires_at
  )
  select new.contact_reference_id, d.key, (d.value ->> 1)::bigint,
    new.status, new.expires_at
  from jsonb_each(v_map) d
  where (d.value ->> 0)::integer = (v_map -> new.contact_hmac ->> 0)::integer
    and d.key <> new.contact_hmac
  on conflict (contact_reference_id, hmac_key_revision) do nothing;
  return null;
end;
$$;
revoke all on function private.link_declared_contact_aliases_v1()
  from public, anon, authenticated, service_role;
create trigger contact_hmac_indexes_link_declared_aliases
  after insert on public.contact_hmac_indexes
  for each row execute function private.link_declared_contact_aliases_v1();

-- barKeyring: a new refusal also bars the same contact under every other
-- usable key revision it is linked to, with the refusal's own target,
-- revision and expiry. The alias bars keep the revisions connected after the
-- contact reference itself is shredded. Only cross-revision aliases between
-- keyring revisions are copied; any other alias edge is left exactly as the
-- refusal bodies already treat it. An alias that already carries a later
-- expiry keeps it: fan-out never shortens another refusal's bar, and it never
-- extends past the refusal it copies.
create function private.cross_revision_contact_aliases_v1(p_hmac text, p_revision bigint)
returns text[] language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(a.hmac order by a.hmac), '{}'::text[])
  from unnest(private.invitation_contact_aliases_v1(p_hmac)) a(hmac)
  cross join lateral (select private.contact_hmac_key_revision_v1(a.hmac) as revision) r
  where a.hmac <> p_hmac
    and p_revision = any(private.hmac_lookup_revisions_v1('contact'))
    and r.revision <> p_revision
    and r.revision = any(private.hmac_lookup_revisions_v1('contact'));
$$;
revoke all on function private.cross_revision_contact_aliases_v1(text, bigint)
  from public, anon, authenticated, service_role;

create function private.fan_out_refusal_bar_aliases_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_table_name = 'contact_refusal_bars' then
    insert into public.contact_refusal_bars (
      contact_hmac, target_kind, target_id, refusal_revision, created_at, expires_at
    )
    select a.hmac, new.target_kind, new.target_id, new.refusal_revision,
      new.created_at, new.expires_at
    from unnest(private.cross_revision_contact_aliases_v1(
      new.contact_hmac, new.hmac_key_revision)) a(hmac)
    on conflict (contact_hmac, target_kind, target_id, refusal_revision) do nothing;
  else
    insert into public.invitation_refusal_hmacs (
      email_hmac, refusal_revision, created_at, expires_at
    )
    select a.hmac, new.refusal_revision, new.created_at, new.expires_at
    from unnest(private.cross_revision_contact_aliases_v1(
      new.email_hmac, new.hmac_key_revision)) a(hmac)
    on conflict (email_hmac) do update set
      expires_at = greatest(public.invitation_refusal_hmacs.expires_at, excluded.expires_at);
  end if;
  return null;
end;
$$;
revoke all on function private.fan_out_refusal_bar_aliases_v1()
  from public, anon, authenticated, service_role;
create trigger contact_refusal_bars_fan_out_aliases
  after insert on public.contact_refusal_bars
  for each row execute function private.fan_out_refusal_bar_aliases_v1();
create trigger invitation_refusal_hmacs_fan_out_aliases
  after insert or update of expires_at on public.invitation_refusal_hmacs
  for each row execute function private.fan_out_refusal_bar_aliases_v1();

-- ---------------------------------------------------------------------------
-- securityRateLimitContract buckets.
--
-- No code path has ever written this table: its only writer,
-- private.consume_rate_limit_v1, had no caller and computed a purge time up
-- to 25 hours after the window, past security.rate-limit-hmac-24h. Any row is
-- therefore a counter nothing reads; removing it only purges early.
drop function private.consume_rate_limit_v1(text, bigint, text, integer, integer, timestamptz);
delete from public.rate_limit_hmac_buckets;
alter table public.rate_limit_hmac_buckets
  drop constraint rate_limit_hmac_buckets_pkey,
  drop column blocked_until,
  add column dimension text not null check (dimension in (
    'source-network', 'normalized-identifier', 'token-or-key-hmac',
    'authenticated-principal', 'machine-endpoint', 'global-capacity'
  )),
  add column first_attempt_at timestamptz not null,
  add column outcome_code text not null check (outcome_code in ('allowed', 'exhausted')),
  add constraint rate_limit_hmac_buckets_pkey primary key (
    action_id, dimension, window_seconds, window_started_at,
    hmac_key_revision, bucket_key_hmac
  ),
  add constraint rate_limit_hmac_buckets_first_attempt_in_window check (
    first_attempt_at >= window_started_at
    and first_attempt_at < window_started_at + make_interval(secs => window_seconds)
  ),
  add constraint rate_limit_hmac_buckets_fixed_purge check (
    expires_at > first_attempt_at
    and expires_at <= first_attempt_at + interval '24 hours'
    and expires_at <= window_started_at + make_interval(secs => window_seconds)
  );
comment on column public.rate_limit_hmac_buckets.expires_at is
  'security.rate-limit-hmac-24h fixed purge_at: set by the first committed attempt and never renewed.';
-- A quota is only as strong as its counters. No API role may write, reset or
-- erase a bucket: the definer functions below are the only writers. The
-- service role keeps read access for inspection, as it does for nonces.
revoke insert, update, delete, truncate, references, trigger
  on public.rate_limit_hmac_buckets from service_role;

-- Reserve and increment one bucket per registered dimension and window, before
-- any identity, resource, token or target match. p_specs is the server-owned
-- ceiling list; p_keys is {"<revision>": {"<dimension>": "<64 hex>"}} from the
-- application, one digest per usable rate-limit revision. An unexpired bucket
-- under a retiring revision keeps counting, so rotation never restarts a
-- window; a new bucket is only ever created under the active revision.
-- Returns whether every bucket is still within its ceiling.
create function private.consume_rate_limit_buckets_v1(
  p_action_id text, p_specs jsonb, p_keys jsonb
)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_revisions bigint[] := private.hmac_lookup_revisions_v1('rate-limit');
  v_active bigint := private.hmac_active_revision_v1('rate-limit');
  v_spec jsonb;
  v_dimension text;
  v_window_seconds integer;
  v_limit integer;
  v_window timestamptz;
  v_revision bigint;
  v_key text;
  v_count integer;
  v_allowed boolean := true;
begin
  if p_action_id !~ '^[a-z][a-z0-9_.-]{2,79}$' or jsonb_typeof(p_specs) <> 'array' then
    raise exception using errcode = '22023', message = 'rate limit request invalid';
  end if;
  if p_keys is null or jsonb_typeof(p_keys) <> 'object'
    or (select count(*) from jsonb_object_keys(p_keys)) > 16
    or exists (
      select 1 from jsonb_each(p_keys) r
      where r.key !~ '^[1-9][0-9]{0,5}$' or jsonb_typeof(r.value) <> 'object'
        or exists (
          select 1 from jsonb_each(r.value) d
          where jsonb_typeof(d.value) <> 'string'
            or (d.value #>> '{}') !~ '^[0-9a-f]{64}$'
        )
    )
  then
    raise exception using errcode = '55000', message = 'rate limit keys required';
  end if;

  for v_spec in select s.value from jsonb_array_elements(p_specs) s loop
    v_dimension := v_spec ->> 'dimension';
    v_window_seconds := (v_spec ->> 'windowSeconds')::integer;
    v_limit := (v_spec ->> 'limit')::integer;
    if v_window_seconds not between 1 and 86400 or v_limit not between 1 and 100000 then
      raise exception using errcode = '22023', message = 'rate limit request invalid';
    end if;
    foreach v_revision in array v_revisions loop
      if p_keys -> v_revision::text ->> v_dimension is null then
        raise exception using errcode = '55000', message = 'rate limit keys required';
      end if;
    end loop;

    -- A 86400-second window is the UTC day: epoch days start at UTC midnight.
    v_window := to_timestamp(
      floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds);
    v_count := null;

    update public.rate_limit_hmac_buckets b
    set request_count = b.request_count + 1,
        outcome_code = case when b.request_count + 1 > v_limit
          then 'exhausted' else b.outcome_code end
    where b.action_id = p_action_id and b.dimension = v_dimension
      and b.window_seconds = v_window_seconds and b.window_started_at = v_window
      and b.hmac_key_revision = any(v_revisions) and b.hmac_key_revision <> v_active
      and b.bucket_key_hmac = p_keys -> b.hmac_key_revision::text ->> v_dimension
      and b.expires_at > v_now
    returning b.request_count into v_count;

    if v_count is null then
      v_key := p_keys -> v_active::text ->> v_dimension;
      insert into public.rate_limit_hmac_buckets as b (
        bucket_key_hmac, hmac_key_revision, action_id, dimension,
        window_started_at, window_seconds, request_count, limit_count,
        first_attempt_at, expires_at, outcome_code
      ) values (
        v_key, v_active, p_action_id, v_dimension, v_window, v_window_seconds,
        1, v_limit, v_now,
        least(v_now + interval '24 hours',
          v_window + make_interval(secs => v_window_seconds)),
        case when 1 > v_limit then 'exhausted' else 'allowed' end
      )
      on conflict (action_id, dimension, window_seconds, window_started_at,
        hmac_key_revision, bucket_key_hmac)
      do update set
        request_count = b.request_count + 1,
        outcome_code = case when b.request_count + 1 > v_limit
          then 'exhausted' else b.outcome_code end
      returning b.request_count into v_count;
    end if;

    if v_count > v_limit then v_allowed := false; end if;
  end loop;
  return v_allowed;
end;
$$;
revoke all on function private.consume_rate_limit_buckets_v1(text, jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- global-contact-refusal-bar-v1.quotaAuthority.perActingAccount: invitation
-- attempts per acting account, 10 an hour and 30 a UTC day. The register's
-- perSourceNetworkHmac bucket (30 an hour) needs the client address, which
-- the application may not read outside the one sanctions check (G5.1a,
-- scripts/jurisdiction-inference.test.ts); it waits on an owner decision and
-- is one more entry in this list once decided.
create function private.consume_invitation_attempt_quota_v1(p_keys jsonb)
returns boolean language sql volatile security invoker set search_path = '' as $$
  select private.consume_rate_limit_buckets_v1(
    'global-contact-refusal-bar-v1.invitation-attempt',
    '[{"dimension":"authenticated-principal","windowSeconds":3600,"limit":10},
      {"dimension":"authenticated-principal","windowSeconds":86400,"limit":30}]'::jsonb,
    p_keys);
$$;
revoke all on function private.consume_invitation_attempt_quota_v1(jsonb)
  from public, anon, authenticated, service_role;

-- security.rate-limit-hmac-24h: delete each bucket at its fixed purge time.
create function private.purge_expired_rate_limit_buckets_v1()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  delete from public.rate_limit_hmac_buckets where expires_at <= clock_timestamp();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.purge_expired_rate_limit_buckets_v1()
  from public, anon, authenticated, service_role;
grant execute on function private.purge_expired_rate_limit_buckets_v1() to service_role;

create function public.purge_expired_rate_limit_buckets_v1()
returns integer language sql security invoker set search_path = '' as $$
  select private.purge_expired_rate_limit_buckets_v1();
$$;
revoke all on function public.purge_expired_rate_limit_buckets_v1()
  from public, anon, authenticated;
grant execute on function public.purge_expired_rate_limit_buckets_v1() to service_role;

-- ---------------------------------------------------------------------------
-- Rotation and retirement. Operator-only: neither is granted to any API role.
-- Invitation transitions and quota consumers read the keyring under the
-- shared invitation transition lock, so no transaction sees half a rotation.

-- Whether any live row still depends on a revision.
create function private.hmac_key_revision_in_use_v1(p_keyring text, p_revision bigint)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case p_keyring
    when 'rate-limit' then exists (
      select 1 from public.rate_limit_hmac_buckets b
      where b.hmac_key_revision = p_revision and b.expires_at > clock_timestamp())
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

-- Make p_new_revision the active revision; the previous one keeps matching as
-- retiring. Deploy the new secret to the application first: from this commit
-- on, a request that cannot present it is refused, not matched with less.
create function private.begin_hmac_key_rotation_v1(p_keyring text, p_new_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_newest bigint;
begin
  perform private.lock_invitation_transitions_v1();
  if p_keyring is null or p_keyring not in ('contact', 'rate-limit') then
    raise exception using errcode = '22023', message = 'unknown keyring';
  end if;
  perform 1 from private.hmac_key_versions v where v.keyring = p_keyring for update;
  select max(v.key_revision) into v_newest
  from private.hmac_key_versions v where v.keyring = p_keyring;
  if p_new_revision is distinct from v_newest + 1 then
    raise exception using errcode = '22023', message = 'key revision must follow the newest';
  end if;
  update private.hmac_key_versions
  set state = 'retiring', retiring_since = clock_timestamp()
  where keyring = p_keyring and state = 'active';
  insert into private.hmac_key_versions (keyring, key_revision, state)
  values (p_keyring, p_new_revision, 'active');
  perform private.append_legal_audit_event(
    'security.hmac-key.rotated', null, 'operations', 'accepted',
    jsonb_build_object('keyring', p_keyring, 'revision', p_new_revision));
end;
$$;
revoke all on function private.begin_hmac_key_rotation_v1(text, bigint)
  from public, anon, authenticated, service_role;

-- Stop matching a retiring revision. Refused while any live bar, pending
-- invitation, pending contact, subject-control authority or unexpired bucket
-- still depends on it.
create function private.retire_hmac_key_version_v1(p_keyring text, p_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_state text;
begin
  perform private.lock_invitation_transitions_v1();
  select v.state into v_state from private.hmac_key_versions v
  where v.keyring = p_keyring and v.key_revision = p_revision
  for update;
  if v_state is distinct from 'retiring' then
    raise exception using errcode = '55000', message = 'only a retiring key revision can retire';
  end if;
  if private.hmac_key_revision_in_use_v1(p_keyring, p_revision) then
    raise exception using errcode = '55000', message = 'key revision still protects live rows';
  end if;
  update private.hmac_key_versions
  set state = 'retired', retired_at = clock_timestamp()
  where keyring = p_keyring and key_revision = p_revision;
  perform private.append_legal_audit_event(
    'security.hmac-key.retired', null, 'operations', 'accepted',
    jsonb_build_object('keyring', p_keyring, 'revision', p_revision));
end;
$$;
revoke all on function private.retire_hmac_key_version_v1(text, bigint)
  from public, anon, authenticated, service_role;
