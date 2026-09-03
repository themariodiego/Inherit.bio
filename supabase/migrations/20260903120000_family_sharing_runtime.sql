-- Family sharing runtime (W9, F0): the platform and consent prerequisites the
-- Family surfaces build against (docs/design/w9-family-surfaces.md §10 F0,
-- docs/route-register.json policyContracts.directional-purpose-grant-v1 and
-- lifecycleDispositionContracts.family-sharing-state-v1).
--
-- 1. Columns: subjects.portrait_acknowledged_at, subjects.independent_login_at,
--    condition_registry.gene_symbols.
-- 2. Stores: family_sharing_pauses (the pause predicate), family_sharing_stops
--    (the stop tombstone), purpose_grant_nonces (single-use presentation
--    nonces). A pause is a table, not family_pairs.paused_at, because a pause
--    is between two accounts and exists whether or not a pair row does: a pair
--    is created only on the first family.portrait grant (decisions.md, W9),
--    while people who share only report layers have no pair to carry a flag.
--    family-sharing-state-v1 also forbids the pause from deleting or
--    terminalising any grant row, and directional_grants has no reversible
--    "inactive" status, so the pause must be a predicate read at every
--    authorisation check rather than a mutation of the grant rows.
-- 3. RPCs (all security definer, empty search_path, service_role only — every
--    caller in this repository is a server route holding the user's session
--    and the account id is a parameter, so an authenticated grant would let a
--    client name any account): grant_directional_purpose_v1,
--    revoke_directional_purpose_v1, pause_family_sharing_v1,
--    resume_family_sharing_v1, stop_family_sharing_v1, acknowledge_portrait_v1,
--    plus mark_independent_login_v1 for the sign-in exchange.
-- 4. private.resource_authorized_v1 learns the pause predicate so a paused
--    relationship denies on the next authorisation check with no row deleted.
--
-- Additive. Account deletion for an account with any cross-account sharing
-- already fails closed (assert_supported_self_deletion_graph_v1); the new
-- account references here must join that resolver's allow-list when the
-- cross-account deletion graph ships.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.subjects
  add column portrait_acknowledged_at timestamptz,
  add column independent_login_at timestamptz;

create or replace function private.valid_gene_symbols(p_symbols text[])
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(
    bool_and(s is not null and s ~ '^[A-Z0-9][A-Z0-9-]{0,29}$'),
    true
  )
  from unnest(p_symbols) as s
$$;

revoke all on function private.valid_gene_symbols(text[]) from public, anon, authenticated;
grant execute on function private.valid_gene_symbols(text[]) to service_role;

alter table public.condition_registry
  add column gene_symbols text[] not null default '{}',
  add constraint condition_registry_gene_symbols_check
    check (private.valid_gene_symbols(gene_symbols));

create index condition_registry_gene_symbols_idx
  on public.condition_registry using gin (gene_symbols);

-- ---------------------------------------------------------------------------
-- 2. Stores
-- ---------------------------------------------------------------------------
create table public.family_sharing_pauses (
  id uuid primary key default gen_random_uuid(),
  account_low_id uuid not null references auth.users (id) on delete restrict,
  account_high_id uuid not null references auth.users (id) on delete restrict,
  paused_by_account_id uuid not null references auth.users (id) on delete restrict,
  paused_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  ended_by_account_id uuid references auth.users (id) on delete restrict,
  end_reason text check (end_reason in ('resumed', 'stopped')),
  check (account_low_id < account_high_id),
  check (paused_by_account_id in (account_low_id, account_high_id)),
  check ((ended_at is null) = (end_reason is null)),
  check ((ended_at is null) = (ended_by_account_id is null)),
  check (ended_at is null or ended_at >= paused_at)
);

create unique index family_sharing_pauses_current_idx
  on public.family_sharing_pauses (account_low_id, account_high_id)
  where ended_at is null;

create table public.family_sharing_stops (
  id uuid primary key default gen_random_uuid(),
  account_low_id uuid not null references auth.users (id) on delete restrict,
  account_high_id uuid not null references auth.users (id) on delete restrict,
  stopped_by_account_id uuid not null references auth.users (id) on delete restrict,
  ended_at timestamptz not null default clock_timestamp(),
  deleted_counts jsonb not null default '{}'::jsonb,
  check (account_low_id < account_high_id),
  check (stopped_by_account_id in (account_low_id, account_high_id)),
  check (jsonb_typeof(deleted_counts) = 'object')
);

create index family_sharing_stops_accounts_idx
  on public.family_sharing_stops (account_low_id, account_high_id, ended_at desc);

-- Only a keyed digest of the presentation nonce is stored (tokenSecurityContract:
-- hash-only persistence). The row is the proof that a token was consumed once.
create table public.purpose_grant_nonces (
  nonce_hash text primary key check (nonce_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid not null references auth.users (id) on delete restrict,
  grant_id uuid references public.purpose_grants (grant_id) on delete restrict,
  consumed_at timestamptz not null default clock_timestamp()
);

alter table public.family_sharing_pauses enable row level security;
alter table public.family_sharing_stops enable row level security;
alter table public.purpose_grant_nonces enable row level security;

revoke all on table public.family_sharing_pauses from public, anon, authenticated;
revoke all on table public.family_sharing_stops from public, anon, authenticated;
revoke all on table public.purpose_grant_nonces from public, anon, authenticated;

grant all on table public.family_sharing_pauses to service_role;
grant all on table public.family_sharing_stops to service_role;
grant all on table public.purpose_grant_nonces to service_role;

-- The one artifact a directional purpose grant between adults is signed
-- against. Version 1; a later version supersedes it through a migration.
insert into public.consent_artifacts (
  artifact_key, version, body_sha256, body_markdown, summary_markdown,
  effective_on
)
select
  'consent.share-with-adult',
  1,
  encode(extensions.digest(convert_to(
    'I choose to let one named adult see one kind of result about my DNA. This covers only the kind I turn on, only for that person, and only from my own account. I can pause it or turn it off at any time. Turning it off deletes every result Inherit built from the two of us.',
    'UTF8'
  ), 'sha256'), 'hex'),
  'I choose to let one named adult see one kind of result about my DNA. This covers only the kind I turn on, only for that person, and only from my own account. I can pause it or turn it off at any time. Turning it off deletes every result Inherit built from the two of us.',
  'One kind of result, for one named adult, from your own account. You can pause it or turn it off at any time.',
  date '2026-09-03'
where not exists (
  select 1 from public.consent_artifacts
  where artifact_key = 'consent.share-with-adult' and version = 1
);

-- ---------------------------------------------------------------------------
-- 3. Private helpers
-- ---------------------------------------------------------------------------

-- True while a current pause row exists between two accounts.
create or replace function private.family_sharing_paused_v1(
  p_account_a uuid,
  p_account_b uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select p_account_a is not null
    and p_account_b is not null
    and exists (
      select 1
      from public.family_sharing_pauses p
      where p.account_low_id = least(p_account_a, p_account_b)
        and p.account_high_id = greatest(p_account_a, p_account_b)
        and p.ended_at is null
    )
$$;

revoke all on function private.family_sharing_paused_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.family_sharing_paused_v1(uuid, uuid) to service_role;

-- The subjects whose data an account holds: its self subject and every adult
-- record bound to it (an accepted invitation binds the invited record to the
-- invitee). Purged rows are excluded.
create or replace function private.account_data_subject_ids_v1(p_account_id uuid)
returns uuid[]
language sql
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.id order by s.created_at, s.id), '{}'::uuid[])
  from public.subjects s
  where s.subject_account_id = p_account_id
    and s.subject_class in ('self', 'other_adult')
    and s.lifecycle <> 'purged'
$$;

revoke all on function private.account_data_subject_ids_v1(uuid)
  from public, anon, authenticated;
grant execute on function private.account_data_subject_ids_v1(uuid) to service_role;

-- Count of live directional grants between two accounts, both ways. A pause
-- does not change this count: the rows stay, the predicate denies them.
create or replace function private.family_live_grant_count_v1(
  p_account_id uuid,
  p_counterpart_account_id uuid
)
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.purpose_grants pg
  join public.directional_grants dg
    on dg.grant_id = pg.grant_id and dg.grant_revision = pg.grant_revision
  join public.subject_principals dsp on dsp.id = pg.data_subject_principal_id
  where pg.revoked_at is null
    and (pg.expires_at is null or pg.expires_at > clock_timestamp())
    and dg.status = 'current'
    and (
      (dsp.account_id = p_account_id and dg.recipient_account_id = p_counterpart_account_id)
      or (dsp.account_id = p_counterpart_account_id and dg.recipient_account_id = p_account_id)
    )
$$;

revoke all on function private.family_live_grant_count_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.family_live_grant_count_v1(uuid, uuid) to service_role;

-- Two accounts are family counterparts when an adult invitation between them
-- was accepted, a live purpose grant exists between them, a current
-- family_member relationship or a pending or current pair links their
-- subjects, or a pause is current. The link never implies a grant; it only
-- says "pause, resume and stop have something to act on". After a stop only
-- the accepted invitation, if any, still links them.
create or replace function private.family_counterpart_linked_v1(
  p_account_id uuid,
  p_counterpart_account_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mine uuid[] := private.account_data_subject_ids_v1(p_account_id);
  v_theirs uuid[] := private.account_data_subject_ids_v1(p_counterpart_account_id);
begin
  if p_account_id is null
    or p_counterpart_account_id is null
    or p_account_id = p_counterpart_account_id then
    return false;
  end if;

  return exists (
    select 1
    from public.subject_invitations si
    join public.subject_principals inviter on inviter.id = si.inviter_principal_id
    join public.subjects invited on invited.id = si.target_id
    where si.invitation_kind = 'adult_subject'
      and si.status = 'accepted'
      and (
        (inviter.account_id = p_account_id
          and invited.subject_account_id = p_counterpart_account_id)
        or (inviter.account_id = p_counterpart_account_id
          and invited.subject_account_id = p_account_id)
      )
  ) or private.family_live_grant_count_v1(p_account_id, p_counterpart_account_id) > 0
  or exists (
    select 1
    from public.subject_relationships sr
    join public.subject_principals dsp on dsp.id = sr.data_subject_principal_id
    where sr.relationship_kind = 'family_member'
      and sr.status = 'current'
      and (
        (dsp.account_id = p_account_id and sr.recipient_account_id = p_counterpart_account_id)
        or (dsp.account_id = p_counterpart_account_id and sr.recipient_account_id = p_account_id)
      )
  ) or exists (
    select 1
    from public.family_pairs fp
    where fp.status in ('pending', 'current')
      and (
        (fp.subject_a_id = any(v_mine) and fp.subject_b_id = any(v_theirs))
        or (fp.subject_a_id = any(v_theirs) and fp.subject_b_id = any(v_mine))
      )
  ) or private.family_sharing_paused_v1(p_account_id, p_counterpart_account_id);
end;
$$;

revoke all on function private.family_counterpart_linked_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.family_counterpart_linked_v1(uuid, uuid) to service_role;

-- Family pairs whose two subjects belong to the two accounts, one each.
create or replace function private.family_pair_ids_between_v1(
  p_account_id uuid,
  p_counterpart_account_id uuid
)
returns uuid[]
language sql
security definer
set search_path = ''
as $$
  select coalesce(array_agg(fp.id order by fp.created_at, fp.id), '{}'::uuid[])
  from public.family_pairs fp
  where fp.status <> 'purged'
    and (
      (fp.subject_a_id = any(private.account_data_subject_ids_v1(p_account_id))
        and fp.subject_b_id = any(private.account_data_subject_ids_v1(p_counterpart_account_id)))
      or (fp.subject_a_id = any(private.account_data_subject_ids_v1(p_counterpart_account_id))
        and fp.subject_b_id = any(private.account_data_subject_ids_v1(p_account_id)))
    )
$$;

revoke all on function private.family_pair_ids_between_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.family_pair_ids_between_v1(uuid, uuid) to service_role;

-- purpose.derived-60s and pair.access-immediate, inline: delete the joint
-- outputs and the chat context built from the exact pair or subject-and-
-- purpose tuple. Returns {"portrait_results": n, "chat_messages": n}.
create or replace function private.delete_pair_derived_rows_v1(
  p_pair_ids uuid[],
  p_recipient_account_id uuid,
  p_subject_ids uuid[],
  p_purpose text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_portrait_count integer := 0;
  v_message_count integer := 0;
  v_pair_message_count integer := 0;
begin
  if cardinality(p_pair_ids) > 0 then
    delete from public.portrait_results pr
    where pr.family_pair_id = any(p_pair_ids);
    get diagnostics v_portrait_count = row_count;

    delete from public.copilot_context_tokens t
    where t.scope_kind = 'family' and t.target_id = any(p_pair_ids);

    delete from public.chat_messages m
    where m.chat_id in (
      select c.id from public.chats c where c.family_pair_id = any(p_pair_ids)
    );
    get diagnostics v_pair_message_count = row_count;
  end if;

  if p_recipient_account_id is not null and cardinality(p_subject_ids) > 0 then
    delete from public.copilot_context_tokens t
    where t.account_id = p_recipient_account_id
      and t.target_id = any(p_subject_ids);

    delete from public.chat_messages m
    where m.user_id = p_recipient_account_id
      and m.retrieved_subject_ids && p_subject_ids
      and (p_purpose is null or m.retrieved_purpose_keys @> array[p_purpose]);
    get diagnostics v_message_count = row_count;

    delete from public.copilot_context_history h
    using public.chats c
    where c.id = h.chat_id
      and c.user_id = p_recipient_account_id
      and h.retrieved_subject_ids && p_subject_ids
      and (p_purpose is null or h.retrieved_purpose_keys @> array[p_purpose]);
  end if;

  return jsonb_build_object(
    'portrait_results', v_portrait_count,
    'chat_messages', v_message_count + v_pair_message_count
  );
end;
$$;

revoke all on function private.delete_pair_derived_rows_v1(uuid[], uuid, uuid[], text)
  from public, anon, authenticated;
grant execute on function private.delete_pair_derived_rows_v1(uuid[], uuid, uuid[], text)
  to service_role;

-- The purge job docs/retention.md names for a revoked purpose or pair:
-- purpose.derived-60s, executed by the revocationDispositionWorker as a
-- worker_jobs row of kind revoke_purge (output lifecycle.revoke-purge, source
-- binding revocation-disposition). One job per account side so each side's
-- derived rows are re-verified under its own subject.
create or replace function private.enqueue_family_revoke_purge_v1(
  p_account_id uuid,
  p_disposition_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject_id uuid;
  v_job public.worker_jobs;
begin
  select s.id into v_subject_id
  from public.subjects s
  where s.subject_account_id = p_account_id
    and s.subject_class = 'self'
    and s.lifecycle in ('active', 'claimed_bound')
  order by s.created_at, s.id
  limit 1;
  if v_subject_id is null then
    return null;
  end if;

  v_job := private.enqueue_worker_job_v2(
    p_account_id,
    'revoke_purge',
    'lifecycle.revoke-purge',
    v_subject_id,
    null,
    'revocation-disposition',
    p_disposition_id,
    1,
    encode(extensions.digest(convert_to(
      concat_ws(':', 'family-revoke-purge-v1', p_disposition_id::text,
        v_subject_id::text, p_payload::text),
      'UTF8'
    ), 'sha256'), 'hex'),
    'family-revoke-purge-v1',
    null,
    p_payload || jsonb_build_object('retention_id', 'purpose.derived-60s',
      'manifest_class', 'purpose-derived-only')
  );
  return v_job.id;
end;
$$;

revoke all on function private.enqueue_family_revoke_purge_v1(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function private.enqueue_family_revoke_purge_v1(uuid, uuid, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. The authorisation predicate learns the pause
-- ---------------------------------------------------------------------------
-- Same body and signature as 20260831224035 / 20260901030100 (volatile), plus:
-- a current pause between the data subject's account and the recipient
-- account denies the grant branch, and a current pause between the two
-- accounts of a pair denies the direct pair branch. No row is changed.
create or replace function private.resource_authorized_v1(
  p_account_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_purpose text,
  p_lifecycle_revision bigint,
  p_grant_revision bigint default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_direct boolean := false;
  v_granted boolean := false;
begin
  if p_target_kind = 'subject' then
    select exists (
      select 1 from public.subjects s
      where s.id = p_target_id
        and s.lifecycle_revision = p_lifecycle_revision
        and s.lifecycle in ('active', 'claimed_bound')
        and (s.owner_account_id = p_account_id or s.subject_account_id = p_account_id)
    ) into v_direct;
  elsif p_target_kind = 'cohort' then
    select exists (
      select 1 from public.embryo_cohorts c
      where c.id = p_target_id
        and c.lifecycle_revision = p_lifecycle_revision
        and c.status in ('upload_pending', 'ingesting', 'active', 'claimed_bound')
        and c.owner_account_id = p_account_id
    ) into v_direct;
  elsif p_target_kind = 'family_pair' then
    select exists (
      select 1
      from public.family_pairs fp
      join public.subjects a on a.id = fp.subject_a_id
      join public.subjects b on b.id = fp.subject_b_id
      where fp.id = p_target_id
        and fp.pair_revision = p_lifecycle_revision
        and fp.status = 'current'
        and (a.owner_account_id = p_account_id or b.owner_account_id = p_account_id)
        and not private.family_sharing_paused_v1(
          coalesce(a.subject_account_id, a.owner_account_id),
          coalesce(b.subject_account_id, b.owner_account_id)
        )
    ) into v_direct;
  else
    return false;
  end if;

  if v_direct and p_grant_revision is null then return true; end if;

  select exists (
    select 1
    from public.purpose_grants pg
    join public.directional_grants dg
      on dg.grant_id = pg.grant_id and dg.grant_revision = pg.grant_revision
    join public.subject_principals dsp on dsp.id = pg.data_subject_principal_id
    where pg.target_kind = p_target_kind
      and pg.target_id = p_target_id
      and pg.purpose = p_purpose
      and pg.grant_revision = p_grant_revision
      and pg.revoked_at is null
      and (pg.expires_at is null or pg.expires_at > clock_timestamp())
      and dg.recipient_account_id = p_account_id
      and dg.status = 'current'
      and not private.family_sharing_paused_v1(dsp.account_id, dg.recipient_account_id)
  ) into v_granted;

  return v_granted or (v_direct and p_grant_revision is not null and v_granted);
end;
$$;

revoke all on function private.resource_authorized_v1(uuid, text, uuid, text, bigint, bigint)
  from public, anon, authenticated;
grant execute on function private.resource_authorized_v1(uuid, text, uuid, text, bigint, bigint)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. RPCs
-- ---------------------------------------------------------------------------

-- grant_directional_purpose_v1: one purpose, one direction, one transaction.
-- Writes the purpose_grants base row and the directional_grants extension at
-- one identical revision under the deferred pair check; for family.portrait
-- creates the family_pairs row (status pending) between the data subject and
-- the recipient's own self subject when absent, and promotes it to current
-- once both own-session directions are live. Only the data subject's own
-- account may grant; a used presentation nonce is rejected before any write.
-- Errors: 42501 grant authority is unavailable (wrong account, unknown
-- subject, recipient, artifact or principal); 22023 purpose is not
-- directional / invalid presentation nonce; 23505 presentation nonce already
-- used; 55000 family sharing is paused / independent login is required /
-- consent artifact is not current.
create or replace function public.grant_directional_purpose_v1(
  p_account_id uuid,
  p_data_subject_id uuid,
  p_recipient_principal_id uuid,
  p_purpose text,
  p_artifact_key text,
  p_artifact_version integer,
  p_token_nonce text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_subject public.subjects%rowtype;
  v_signer public.subject_principals%rowtype;
  v_recipient public.subject_principals%rowtype;
  v_recipient_self_subject_id uuid;
  v_profile public.profiles%rowtype;
  v_artifact public.consent_artifacts%rowtype;
  v_nonce_hash text;
  v_existing_grant_id uuid;
  v_relationship_id uuid;
  v_relationship_revision bigint;
  v_pair public.family_pairs%rowtype;
  v_signature_id uuid;
  v_grant_id uuid;
  v_reverse_live boolean := false;
begin
  if p_purpose is null or p_purpose not in (
    'reports.monogenic', 'reports.polygenic', 'ancestry', 'copilot.local',
    'family.heritability', 'family.portrait', 'export.share-link', 'raw.export'
  ) then
    raise exception using errcode = '22023', message = 'purpose is not directional';
  end if;
  if p_token_nonce is null
    or char_length(p_token_nonce) not between 16 and 256
    or p_token_nonce ~ '\s' then
    raise exception using errcode = '22023', message = 'invalid presentation nonce';
  end if;

  -- The data subject must be a record the caller's own account holds.
  select s.* into v_subject
  from public.subjects s
  where s.id = p_data_subject_id
    and s.subject_account_id = p_account_id
    and s.subject_class in ('self', 'other_adult')
    and s.lifecycle = 'active'
  for update;
  if v_subject.id is null then
    raise exception using errcode = '42501', message = 'grant authority is unavailable';
  end if;

  select sp.* into v_signer
  from public.subject_principals sp
  where sp.subject_id = v_subject.id
    and sp.account_id = p_account_id
    and sp.principal_kind = 'account_subject'
    and sp.status = 'active'
  order by sp.created_at
  limit 1
  for update;
  if v_signer.id is null then
    raise exception using errcode = '42501', message = 'grant authority is unavailable';
  end if;

  select sp.* into v_recipient
  from public.subject_principals sp
  where sp.id = p_recipient_principal_id
    and sp.principal_kind = 'account_subject'
    and sp.status = 'active'
    and sp.account_id is not null
    and sp.account_id <> p_account_id;
  if v_recipient.id is null then
    raise exception using errcode = '42501', message = 'grant authority is unavailable';
  end if;

  select s.id into v_recipient_self_subject_id
  from public.subjects s
  where s.subject_account_id = v_recipient.account_id
    and s.subject_class = 'self'
    and s.lifecycle = 'active'
  order by s.created_at, s.id
  limit 1;
  if v_recipient_self_subject_id is null then
    raise exception using errcode = '42501', message = 'grant authority is unavailable';
  end if;

  select * into v_profile from public.profiles where id = p_account_id for update;
  if v_profile.id is null then
    raise exception using errcode = '42501', message = 'grant authority is unavailable';
  end if;

  if p_artifact_key is distinct from 'consent.share-with-adult' then
    raise exception using errcode = '22023',
      message = 'consent artifact does not govern directional sharing';
  end if;
  select * into v_artifact
  from public.consent_artifacts a
  where a.artifact_key = p_artifact_key
    and a.version = p_artifact_version
    and a.superseded_at is null
    and a.published_at <= v_now;
  if v_artifact.artifact_key is null then
    raise exception using errcode = '55000', message = 'consent artifact is not current';
  end if;

  if private.family_sharing_paused_v1(p_account_id, v_recipient.account_id) then
    raise exception using errcode = '55000', message = 'family sharing is paused';
  end if;

  if p_purpose in ('family.heritability', 'family.portrait')
    and v_subject.independent_login_at is null then
    raise exception using errcode = '55000', message = 'independent login is required';
  end if;

  -- The presentation token is single-use: the nonce is consumed before any
  -- grant write, and a second presentation of the same nonce fails closed.
  v_nonce_hash := encode(extensions.digest(convert_to(p_token_nonce, 'UTF8'), 'sha256'), 'hex');
  begin
    insert into public.purpose_grant_nonces (nonce_hash, account_id)
    values (v_nonce_hash, p_account_id);
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'presentation nonce already used';
  end;

  -- An identical live grant is returned rather than duplicated.
  select pg.grant_id into v_existing_grant_id
  from public.purpose_grants pg
  join public.directional_grants dg
    on dg.grant_id = pg.grant_id and dg.grant_revision = pg.grant_revision
  where pg.target_kind = 'subject'
    and pg.target_id = v_subject.id
    and pg.purpose = p_purpose
    and pg.data_subject_principal_id = v_signer.id
    and pg.revoked_at is null
    and (pg.expires_at is null or pg.expires_at > v_now)
    and dg.recipient_principal_id = v_recipient.id
    and dg.status = 'current'
  limit 1;
  if v_existing_grant_id is not null then
    update public.purpose_grant_nonces
    set grant_id = v_existing_grant_id
    where nonce_hash = v_nonce_hash;
    return v_existing_grant_id;
  end if;

  if p_purpose = 'family.portrait' then
    select fp.* into v_pair
    from public.family_pairs fp
    where fp.subject_low_id = least(v_subject.id, v_recipient_self_subject_id)
      and fp.subject_high_id = greatest(v_subject.id, v_recipient_self_subject_id)
    for update;
    if v_pair.id is null then
      insert into public.family_pairs (subject_a_id, subject_b_id, status)
      values (v_subject.id, v_recipient_self_subject_id, 'pending')
      returning * into v_pair;
    elsif v_pair.status = 'purged' then
      raise exception using errcode = '42501', message = 'grant authority is unavailable';
    elsif v_pair.status = 'revoked' then
      update public.family_pairs
      set status = 'pending', pair_revision = pair_revision + 1
      where id = v_pair.id
      returning * into v_pair;
    end if;
  else
    select sr.id, sr.relationship_revision
      into v_relationship_id, v_relationship_revision
    from public.subject_relationships sr
    where sr.subject_id = v_subject.id
      and sr.data_subject_principal_id = v_signer.id
      and sr.recipient_principal_id = v_recipient.id
      and sr.relationship_kind = 'family_member'
      and sr.status = 'current'
    for update;
    if v_relationship_id is null then
      insert into public.subject_relationships (
        subject_id, data_subject_principal_id, recipient_principal_id,
        recipient_account_id, relationship_kind, relationship_revision, status
      ) values (
        v_subject.id, v_signer.id, v_recipient.id, v_recipient.account_id,
        'family_member', 1, 'current'
      ) returning id, relationship_revision
        into v_relationship_id, v_relationship_revision;
    end if;
  end if;

  insert into public.consent_signatures (
    artifact_key, artifact_version, artifact_body_sha256,
    signer_principal_id, signer_account_id, target_kind, target_id,
    purpose, statement_keys, jurisdiction_code, jurisdiction_revision,
    subject_binding_revision
  ) values (
    v_artifact.artifact_key, v_artifact.version, v_artifact.body_sha256,
    v_signer.id, p_account_id, 'subject', v_subject.id,
    p_purpose,
    array['one-purpose', 'one-named-adult', 'own-account', 'pause-or-stop-any-time'],
    coalesce(v_profile.jurisdiction_code, 'ZZ'),
    v_profile.jurisdiction_revision, v_subject.subject_binding_revision
  ) returning id into v_signature_id;

  insert into public.purpose_grants (
    grant_revision, target_kind, target_id, purpose,
    artifact_key, artifact_version, artifact_body_sha256, signature_id,
    signer_principal_id, data_subject_principal_id, subject_binding_revision,
    jurisdiction_code, jurisdiction_revision
  ) values (
    1, 'subject', v_subject.id, p_purpose,
    v_artifact.artifact_key, v_artifact.version, v_artifact.body_sha256,
    v_signature_id, v_signer.id, v_signer.id, v_subject.subject_binding_revision,
    coalesce(v_profile.jurisdiction_code, 'ZZ'), v_profile.jurisdiction_revision
  ) returning grant_id into v_grant_id;

  insert into public.directional_grants (
    grant_id, grant_revision, recipient_principal_id, recipient_account_id,
    relationship_id, pair_id, relationship_or_pair_revision, direction, status
  ) values (
    v_grant_id, 1, v_recipient.id, v_recipient.account_id,
    v_relationship_id, v_pair.id,
    coalesce(v_pair.pair_revision, v_relationship_revision), 'subject_to_recipient',
    'current'
  );

  update public.purpose_grant_nonces
  set grant_id = v_grant_id
  where nonce_hash = v_nonce_hash;

  if p_purpose = 'family.portrait' and v_pair.status = 'pending' then
    select exists (
      select 1
      from public.purpose_grants pg
      join public.directional_grants dg
        on dg.grant_id = pg.grant_id and dg.grant_revision = pg.grant_revision
      join public.subject_principals dsp on dsp.id = pg.data_subject_principal_id
      where pg.purpose = 'family.portrait'
        and pg.target_kind = 'subject'
        and pg.target_id = v_recipient_self_subject_id
        and dsp.account_id = v_recipient.account_id
        and pg.revoked_at is null
        and (pg.expires_at is null or pg.expires_at > v_now)
        and dg.recipient_account_id = p_account_id
        and dg.status = 'current'
    ) into v_reverse_live;
    if v_reverse_live then
      update public.family_pairs
      set status = 'current'
      where id = v_pair.id;
    end if;
  end if;

  perform private.append_legal_audit_event(
    'purpose.granted', null, 'api.consents', 'accepted',
    jsonb_build_object('purpose', p_purpose, 'direction', 'subject_to_recipient',
      'revision', 1)
  );

  return v_grant_id;
end;
$$;

revoke all on function public.grant_directional_purpose_v1(
  uuid, uuid, uuid, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.grant_directional_purpose_v1(
  uuid, uuid, uuid, text, text, integer, text
) to service_role;

-- revoke_directional_purpose_v1: the data subject's own account ends one
-- grant. Both rows are terminalised in one transaction; the exact
-- subject-and-purpose derived rows the recipient held are deleted inline
-- (purpose.derived-60s) and re-verified by the purge job. A family.portrait
-- revocation returns the pair to pending. Returns the revocation timestamp.
-- Errors: 42501 grant authority is unavailable (unknown, foreign or already
-- ended grant; no existence signal).
create or replace function public.revoke_directional_purpose_v1(
  p_account_id uuid,
  p_grant_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_base public.purpose_grants%rowtype;
  v_direction public.directional_grants%rowtype;
  v_signer_account_id uuid;
  v_pair_ids uuid[] := '{}'::uuid[];
  v_counts jsonb;
begin
  select pg.* into v_base
  from public.purpose_grants pg
  where pg.grant_id = p_grant_id
  for update;
  select dg.* into v_direction
  from public.directional_grants dg
  where dg.grant_id = p_grant_id
  for update;
  if v_base.grant_id is null or v_direction.grant_id is null
    or v_base.grant_revision <> v_direction.grant_revision
    or v_base.revoked_at is not null
    or v_direction.status <> 'current' then
    raise exception using errcode = '42501', message = 'grant authority is unavailable';
  end if;

  select sp.account_id into v_signer_account_id
  from public.subject_principals sp
  where sp.id = v_base.data_subject_principal_id;
  if v_signer_account_id is null or v_signer_account_id <> p_account_id then
    raise exception using errcode = '42501', message = 'grant authority is unavailable';
  end if;

  update public.purpose_grants
  set revoked_at = v_now, revocation_reason = 'withdrawn'
  where grant_id = p_grant_id;
  update public.directional_grants
  set status = 'revoked', ended_at = v_now
  where grant_id = p_grant_id;

  if v_base.purpose = 'family.portrait' and v_direction.pair_id is not null then
    v_pair_ids := array[v_direction.pair_id];
    update public.family_pairs
    set status = 'pending'
    where id = v_direction.pair_id and status = 'current';
  end if;

  v_counts := private.delete_pair_derived_rows_v1(
    v_pair_ids, v_direction.recipient_account_id, array[v_base.target_id], v_base.purpose
  );

  perform private.enqueue_family_revoke_purge_v1(
    p_account_id, v_base.grant_id,
    jsonb_build_object('disposition', 'purpose-revocation', 'purpose', v_base.purpose,
      'grant_id', v_base.grant_id, 'pair_ids', to_jsonb(v_pair_ids))
  );

  perform private.append_legal_audit_event(
    'purpose.revoked', null, 'api.consent-revoke', 'accepted',
    jsonb_build_object('purpose', v_base.purpose, 'revision', v_base.grant_revision,
      'deleted', v_counts)
  );

  return v_now;
end;
$$;

revoke all on function public.revoke_directional_purpose_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_directional_purpose_v1(uuid, uuid) to service_role;

-- pause_family_sharing_v1: either side pauses. No grant row changes; the
-- pause row is the predicate every authorisation check reads, so every
-- derived surface denies on the next query. Chat and download contexts
-- between the two accounts are invalidated. Idempotent while paused.
-- Returns the number of grants between the two accounts now held inactive.
-- Errors: 42501 family sharing authority is unavailable; 55000 no family
-- sharing between these accounts.
create or replace function public.pause_family_sharing_v1(
  p_account_id uuid,
  p_counterpart_account_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mine uuid[];
  v_theirs uuid[];
  v_pair_ids uuid[];
begin
  if p_account_id is null or p_counterpart_account_id is null
    or p_account_id = p_counterpart_account_id then
    raise exception using errcode = '42501', message = 'family sharing authority is unavailable';
  end if;
  perform 1 from public.profiles where id = p_account_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'family sharing authority is unavailable';
  end if;
  if not private.family_counterpart_linked_v1(p_account_id, p_counterpart_account_id) then
    raise exception using errcode = '55000', message = 'no family sharing between these accounts';
  end if;

  if not private.family_sharing_paused_v1(p_account_id, p_counterpart_account_id) then
    insert into public.family_sharing_pauses (
      account_low_id, account_high_id, paused_by_account_id
    ) values (
      least(p_account_id, p_counterpart_account_id),
      greatest(p_account_id, p_counterpart_account_id),
      p_account_id
    );

    v_mine := private.account_data_subject_ids_v1(p_account_id);
    v_theirs := private.account_data_subject_ids_v1(p_counterpart_account_id);
    v_pair_ids := private.family_pair_ids_between_v1(p_account_id, p_counterpart_account_id);
    delete from public.copilot_context_tokens t
    where (t.account_id = p_account_id and t.target_id = any(v_theirs))
       or (t.account_id = p_counterpart_account_id and t.target_id = any(v_mine))
       or (t.scope_kind = 'family' and t.target_id = any(v_pair_ids));

    perform private.append_legal_audit_event(
      'family.sharing_paused', null, 'api.family-sharing', 'accepted',
      jsonb_build_object('revision', 1)
    );
  end if;

  return private.family_live_grant_count_v1(p_account_id, p_counterpart_account_id);
end;
$$;

revoke all on function public.pause_family_sharing_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.pause_family_sharing_v1(uuid, uuid) to service_role;

-- resume_family_sharing_v1: either side ends the current pause. Only grants
-- that remain unrevoked and unexpired become live again, because nothing
-- else changed; the route re-checks jurisdiction and capability before
-- calling (family.permissions guards resume). Returns the live grant count.
-- Errors: 42501 family sharing authority is unavailable; 55000 family
-- sharing is not paused.
create or replace function public.resume_family_sharing_v1(
  p_account_id uuid,
  p_counterpart_account_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_account_id is null or p_counterpart_account_id is null
    or p_account_id = p_counterpart_account_id then
    raise exception using errcode = '42501', message = 'family sharing authority is unavailable';
  end if;
  perform 1 from public.profiles where id = p_account_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'family sharing authority is unavailable';
  end if;

  update public.family_sharing_pauses p
  set ended_at = v_now, ended_by_account_id = p_account_id, end_reason = 'resumed'
  where p.account_low_id = least(p_account_id, p_counterpart_account_id)
    and p.account_high_id = greatest(p_account_id, p_counterpart_account_id)
    and p.ended_at is null;
  if not found then
    raise exception using errcode = '55000', message = 'family sharing is not paused';
  end if;

  perform private.append_legal_audit_event(
    'family.sharing_resumed', null, 'api.family-sharing', 'accepted',
    jsonb_build_object('revision', 1)
  );

  return private.family_live_grant_count_v1(p_account_id, p_counterpart_account_id);
end;
$$;

revoke all on function public.resume_family_sharing_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resume_family_sharing_v1(uuid, uuid) to service_role;

-- stop_family_sharing_v1: one destructive action from either side. Revokes
-- every grant between the two accounts both ways, ends their family_member
-- relationships, deletes every portrait_results row for their pairs and every
-- chat message attributable to the other side's subjects or to a pair chat,
-- sets each pair to revoked at a new pair revision, ends any pause, writes the
-- tombstone row both accounts read, and enqueues the purpose.derived-60s
-- purge job (worker_jobs kind revoke_purge) for each side. Each side's own
-- source files and individual results are untouched.
-- Errors: 42501 family sharing authority is unavailable; 55000 no family
-- sharing between these accounts.
create or replace function public.stop_family_sharing_v1(
  p_account_id uuid,
  p_counterpart_account_id uuid
)
returns table (ended_at timestamptz, deleted_counts jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_mine uuid[];
  v_theirs uuid[];
  v_pair_ids uuid[];
  v_grant_ids uuid[];
  v_stop_id uuid;
  v_counts_mine jsonb;
  v_counts_theirs jsonb;
  v_counts jsonb;
  v_payload jsonb;
begin
  if p_account_id is null or p_counterpart_account_id is null
    or p_account_id = p_counterpart_account_id then
    raise exception using errcode = '42501', message = 'family sharing authority is unavailable';
  end if;
  perform 1 from public.profiles where id = p_account_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'family sharing authority is unavailable';
  end if;
  if not private.family_counterpart_linked_v1(p_account_id, p_counterpart_account_id) then
    raise exception using errcode = '55000', message = 'no family sharing between these accounts';
  end if;

  v_mine := private.account_data_subject_ids_v1(p_account_id);
  v_theirs := private.account_data_subject_ids_v1(p_counterpart_account_id);
  v_pair_ids := private.family_pair_ids_between_v1(p_account_id, p_counterpart_account_id);

  -- Every live grant between the two accounts, both ways, locked and revoked
  -- as base plus direction under the deferred pair check.
  select coalesce(array_agg(pg.grant_id), '{}'::uuid[]) into v_grant_ids
  from public.purpose_grants pg
  join public.directional_grants dg on dg.grant_id = pg.grant_id
  join public.subject_principals dsp on dsp.id = pg.data_subject_principal_id
  where pg.revoked_at is null
    and (
      (dsp.account_id = p_account_id and dg.recipient_account_id = p_counterpart_account_id)
      or (dsp.account_id = p_counterpart_account_id and dg.recipient_account_id = p_account_id)
    );
  perform 1 from public.purpose_grants pg where pg.grant_id = any(v_grant_ids) for update;
  perform 1 from public.directional_grants dg where dg.grant_id = any(v_grant_ids) for update;
  update public.purpose_grants
  set revoked_at = v_now, revocation_reason = 'relationship_changed'
  where grant_id = any(v_grant_ids);
  update public.directional_grants
  set status = 'revoked', ended_at = v_now
  where grant_id = any(v_grant_ids) and status = 'current';

  update public.subject_relationships sr
  set status = 'revoked', ended_at = v_now
  from public.subject_principals dsp
  where dsp.id = sr.data_subject_principal_id
    and sr.relationship_kind = 'family_member'
    and sr.status = 'current'
    and (
      (dsp.account_id = p_account_id and sr.recipient_account_id = p_counterpart_account_id)
      or (dsp.account_id = p_counterpart_account_id and sr.recipient_account_id = p_account_id)
    );

  v_counts_mine := private.delete_pair_derived_rows_v1(v_pair_ids, p_account_id, v_theirs, null);
  v_counts_theirs := private.delete_pair_derived_rows_v1('{}'::uuid[], p_counterpart_account_id, v_mine, null);
  v_counts := jsonb_build_object(
    'portrait_results',
      (v_counts_mine ->> 'portrait_results')::integer,
    'chat_messages',
      (v_counts_mine ->> 'chat_messages')::integer + (v_counts_theirs ->> 'chat_messages')::integer
  );

  update public.family_pairs fp
  set status = 'revoked', pair_revision = fp.pair_revision + 1
  where fp.id = any(v_pair_ids) and fp.status <> 'revoked';

  update public.family_sharing_pauses p
  set ended_at = v_now, ended_by_account_id = p_account_id, end_reason = 'stopped'
  where p.account_low_id = least(p_account_id, p_counterpart_account_id)
    and p.account_high_id = greatest(p_account_id, p_counterpart_account_id)
    and p.ended_at is null;

  insert into public.family_sharing_stops (
    account_low_id, account_high_id, stopped_by_account_id, ended_at, deleted_counts
  ) values (
    least(p_account_id, p_counterpart_account_id),
    greatest(p_account_id, p_counterpart_account_id),
    p_account_id, v_now, v_counts
  ) returning id into v_stop_id;

  v_payload := jsonb_build_object(
    'disposition', 'family-sharing-stop', 'stop_id', v_stop_id,
    'pair_ids', to_jsonb(v_pair_ids), 'grant_ids', to_jsonb(v_grant_ids)
  );
  perform private.enqueue_family_revoke_purge_v1(p_account_id, v_stop_id, v_payload);
  perform private.enqueue_family_revoke_purge_v1(p_counterpart_account_id, v_stop_id, v_payload);

  perform private.append_legal_audit_event(
    'family.sharing_stopped', null, 'api.family-sharing', 'accepted',
    jsonb_build_object('revoked_grants', cardinality(v_grant_ids),
      'pairs', cardinality(v_pair_ids), 'deleted', v_counts, 'revision', 1)
  );

  return query select v_now, v_counts;
end;
$$;

revoke all on function public.stop_family_sharing_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.stop_family_sharing_v1(uuid, uuid) to service_role;

-- acknowledge_portrait_v1: stamps subjects.portrait_acknowledged_at once, on a
-- subject the caller's own account holds, and returns the stamp. A second
-- call returns the first stamp. Any other subject is refused with no
-- existence signal.
-- Errors: 42501 portrait acknowledgement authority is unavailable.
create or replace function public.acknowledge_portrait_v1(
  p_account_id uuid,
  p_subject_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject public.subjects%rowtype;
begin
  select s.* into v_subject
  from public.subjects s
  where s.id = p_subject_id
    and s.subject_account_id = p_account_id
    and s.subject_class in ('self', 'other_adult')
    and s.lifecycle = 'active'
  for update;
  if v_subject.id is null then
    raise exception using errcode = '42501',
      message = 'portrait acknowledgement authority is unavailable';
  end if;
  if v_subject.portrait_acknowledged_at is not null then
    return v_subject.portrait_acknowledged_at;
  end if;

  update public.subjects
  set portrait_acknowledged_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = v_subject.id
  returning portrait_acknowledged_at into v_subject.portrait_acknowledged_at;

  perform private.append_legal_audit_event(
    'portrait.acknowledged', null, 'api.family-acknowledge', 'accepted',
    jsonb_build_object('revision', 1)
  );
  return v_subject.portrait_acknowledged_at;
end;
$$;

revoke all on function public.acknowledge_portrait_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.acknowledge_portrait_v1(uuid, uuid) to service_role;

-- mark_independent_login_v1: the independent-login marker the register's
-- auth.callback policy describes (independentLoginMarker). Called by the
-- ordinary sign-in exchange with the server-verified auth session id; for
-- each adult or self subject bound to the account it sets independent_login_at
-- once, only when null, and only when the session is server-proven not to be
-- the one an accepted invitation was consumed in (the session post-dates the
-- acceptance). No revision is changed and every later call is a no-op.
-- Returns the number of subjects stamped.
-- Errors: 42501 auth session is unavailable (unknown, foreign or expired).
create or replace function public.mark_independent_login_v1(
  p_account_id uuid,
  p_auth_session_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session auth.sessions%rowtype;
  v_count integer := 0;
begin
  select s.* into v_session
  from auth.sessions s
  where s.id = p_auth_session_id and s.user_id = p_account_id;
  if v_session.id is null
    or (v_session.not_after is not null and v_session.not_after <= clock_timestamp()) then
    raise exception using errcode = '42501', message = 'auth session is unavailable';
  end if;

  update public.subjects s
  set independent_login_at = clock_timestamp()
  where s.subject_account_id = p_account_id
    and s.subject_class in ('self', 'other_adult')
    and s.lifecycle in ('active', 'claimed_bound')
    and s.independent_login_at is null
    and not exists (
      select 1
      from public.subject_invitations si
      where si.target_id = s.id
        and si.invitation_kind = 'adult_subject'
        and si.status = 'accepted'
        and si.accepted_at >= v_session.created_at
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_independent_login_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_independent_login_v1(uuid, uuid) to service_role;
