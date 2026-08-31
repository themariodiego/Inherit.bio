-- Append-only, database-serialized legal audit chain.

create table public.audit_principals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp()
);

create table public.audit_principal_links (
  audit_principal_id uuid primary key references public.audit_principals (id) on delete restrict,
  account_ciphertext bytea,
  subject_ciphertext bytea,
  key_revision bigint not null check (key_revision > 0),
  crypto_shredded_at timestamptz,
  check (account_ciphertext is not null or subject_ciphertext is not null or crypto_shredded_at is not null)
);

create table public.audit_principal_link_keys (
  audit_principal_id uuid primary key references public.audit_principal_links (audit_principal_id) on delete cascade,
  key_ciphertext bytea,
  key_revision bigint not null check (key_revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  shredded_at timestamptz,
  check ((shredded_at is null) = (key_ciphertext is not null))
);

create table public.legal_audit_retention_checkpoints (
  id bigint generated always as identity primary key,
  removed_through_seq bigint not null unique check (removed_through_seq > 0),
  removed_through_row_hash bytea not null check (octet_length(removed_through_row_hash) = 32),
  removed_through_occurred_at timestamptz not null,
  first_retained_seq bigint,
  first_retained_prev_hash bytea check (first_retained_prev_hash is null or octet_length(first_retained_prev_hash) = 32),
  retention_row_id uuid not null,
  phase_revision bigint not null check (phase_revision > 0),
  row_count bigint not null check (row_count > 0),
  checkpoint_hash bytea not null unique check (octet_length(checkpoint_hash) = 32),
  created_at timestamptz not null default clock_timestamp()
);

create table public.legal_audit_log (
  seq bigint primary key check (seq > 0),
  occurred_at timestamptz not null,
  event_code text not null check (event_code ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  audit_principal_id uuid references public.audit_principals (id) on delete restrict,
  route_id text check (route_id is null or route_id ~ '^[a-z][a-z0-9_.-]{2,99}$'),
  outcome_code text not null check (outcome_code ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  coded_context jsonb not null default '{}'::jsonb,
  previous_hash bytea not null check (octet_length(previous_hash) = 32),
  row_hash bytea not null unique check (octet_length(row_hash) = 32),
  check (jsonb_typeof(coded_context) = 'object'),
  check (not (coded_context ?| array[
    'account_id', 'subject_id', 'email', 'name', 'token', 'ip', 'user_agent',
    'genotype', 'variant', 'finding', 'message', 'prompt', 'response'
  ]))
);

create index legal_audit_log_time_idx on public.legal_audit_log (occurred_at, seq);
create index legal_audit_log_principal_idx on public.legal_audit_log (audit_principal_id, seq);

create or replace function private.guard_legal_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('inherit.audit_mutation', true), '') <> 'on' then
    raise exception using errcode = '42501', message = 'legal audit ledger is append-only';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'TRUNCATE' then return null; end if;
  return new;
end;
$$;

revoke all on function private.guard_legal_audit_mutation() from public, anon, authenticated;
grant execute on function private.guard_legal_audit_mutation() to service_role;

create trigger legal_audit_log_guard_row
before update or delete on public.legal_audit_log
for each row execute function private.guard_legal_audit_mutation();
create trigger legal_audit_log_guard_truncate
before truncate on public.legal_audit_log
for each statement execute function private.guard_legal_audit_mutation();

create or replace function private.append_legal_audit_event(
  p_event_code text,
  p_audit_principal_id uuid,
  p_route_id text,
  p_outcome_code text,
  p_coded_context jsonb default '{}'::jsonb
)
returns public.legal_audit_log
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_seq bigint;
  v_prev_time timestamptz;
  v_prev_hash bytea;
  v_seq bigint;
  v_time timestamptz;
  v_hash bytea;
  v_row public.legal_audit_log;
begin
  perform pg_catalog.pg_advisory_xact_lock(1229866068, 1);

  select l.seq, l.occurred_at, l.row_hash
    into v_prev_seq, v_prev_time, v_prev_hash
  from public.legal_audit_log l
  order by l.seq desc
  limit 1;

  if v_prev_seq is null then
    select c.removed_through_seq, c.removed_through_occurred_at, c.removed_through_row_hash
      into v_prev_seq, v_prev_time, v_prev_hash
    from public.legal_audit_retention_checkpoints c
    order by c.removed_through_seq desc
    limit 1;
  end if;

  v_seq := coalesce(v_prev_seq, 0) + 1;
  v_time := greatest(clock_timestamp(), coalesce(v_prev_time, '-infinity'::timestamptz));
  v_prev_hash := coalesce(v_prev_hash, decode(repeat('00', 32), 'hex'));
  v_hash := extensions.digest(
    pg_catalog.convert_to(
      v_seq::text || '|' || v_time::text || '|' || p_event_code || '|' ||
      coalesce(p_audit_principal_id::text, '') || '|' || coalesce(p_route_id, '') || '|' ||
      p_outcome_code || '|' || coalesce(p_coded_context, '{}'::jsonb)::text || '|' ||
      encode(v_prev_hash, 'hex'),
      'utf8'
    ),
    'sha256'
  );

  perform pg_catalog.set_config('inherit.audit_mutation', 'on', true);
  insert into public.legal_audit_log (
    seq, occurred_at, event_code, audit_principal_id, route_id,
    outcome_code, coded_context, previous_hash, row_hash
  ) values (
    v_seq, v_time, p_event_code, p_audit_principal_id, p_route_id,
    p_outcome_code, coalesce(p_coded_context, '{}'::jsonb), v_prev_hash, v_hash
  ) returning * into v_row;
  perform pg_catalog.set_config('inherit.audit_mutation', 'off', true);
  return v_row;
end;
$$;

revoke all on function private.append_legal_audit_event(text, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function private.append_legal_audit_event(text, uuid, text, text, jsonb)
  to service_role;

create or replace function private.checkpoint_expired_legal_audit_prefix(
  p_through_seq bigint,
  p_retention_row_id uuid,
  p_phase_revision bigint
)
returns public.legal_audit_retention_checkpoints
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_expected_seq bigint;
  v_expected_hash bytea;
  v_count bigint := 0;
  v_through public.legal_audit_log;
  v_checkpoint public.legal_audit_retention_checkpoints;
  v_first_retained_seq bigint;
  v_checkpoint_hash bytea;
begin
  perform pg_catalog.pg_advisory_xact_lock(1229866068, 1);

  select coalesce(max(c.removed_through_seq), 0),
         coalesce((array_agg(c.removed_through_row_hash order by c.removed_through_seq desc))[1], decode(repeat('00', 32), 'hex'))
    into v_expected_seq, v_expected_hash
  from public.legal_audit_retention_checkpoints c;

  for v_row in
    select * from public.legal_audit_log where seq <= p_through_seq order by seq
  loop
    if v_row.seq <> v_expected_seq + 1 or v_row.previous_hash <> v_expected_hash then
      raise exception using errcode = '23514', message = 'legal audit chain verification failed';
    end if;
    v_expected_seq := v_row.seq;
    v_expected_hash := v_row.row_hash;
    v_count := v_count + 1;
    v_through := v_row;
  end loop;

  if v_count = 0 or v_through.seq <> p_through_seq then
    raise exception using errcode = '22023', message = 'checkpoint must be a contiguous retained prefix';
  end if;
  if v_through.occurred_at > clock_timestamp() - interval '7 years' then
    raise exception using errcode = '22023', message = 'audit prefix has not reached seven years';
  end if;

  select min(seq) into v_first_retained_seq
  from public.legal_audit_log where seq > p_through_seq;
  v_checkpoint_hash := extensions.digest(
    int8send(v_through.seq) || v_through.row_hash
      || coalesce(int8send(v_first_retained_seq), ''::bytea)
      || coalesce((select previous_hash from public.legal_audit_log where seq = v_first_retained_seq), ''::bytea)
      || uuid_send(p_retention_row_id) || int8send(p_phase_revision),
    'sha256'
  );

  insert into public.legal_audit_retention_checkpoints (
    removed_through_seq, removed_through_row_hash, removed_through_occurred_at,
    first_retained_seq, first_retained_prev_hash, retention_row_id,
    phase_revision, row_count, checkpoint_hash
  ) values (
    v_through.seq, v_through.row_hash, v_through.occurred_at,
    v_first_retained_seq,
    (select previous_hash from public.legal_audit_log where seq = v_first_retained_seq),
    p_retention_row_id, p_phase_revision, v_count, v_checkpoint_hash
  ) returning * into v_checkpoint;

  perform pg_catalog.set_config('inherit.audit_mutation', 'on', true);
  delete from public.legal_audit_log where seq <= p_through_seq;
  perform pg_catalog.set_config('inherit.audit_mutation', 'off', true);

  perform private.append_legal_audit_event(
    'retention.audit_prefix_checkpointed', null, null, 'completed',
    jsonb_build_object('through_seq', p_through_seq, 'row_count', v_count)
  );
  return v_checkpoint;
end;
$$;

revoke all on function private.checkpoint_expired_legal_audit_prefix(bigint, uuid, bigint)
  from public, anon, authenticated;
grant execute on function private.checkpoint_expired_legal_audit_prefix(bigint, uuid, bigint)
  to service_role;

alter table public.audit_principals enable row level security;
alter table public.audit_principal_links enable row level security;
alter table public.audit_principal_link_keys enable row level security;
alter table public.legal_audit_retention_checkpoints enable row level security;
alter table public.legal_audit_log enable row level security;
revoke all on table public.audit_principals, public.audit_principal_links,
  public.audit_principal_link_keys, public.legal_audit_retention_checkpoints,
  public.legal_audit_log from anon, authenticated;
grant all on table public.audit_principals, public.audit_principal_links,
  public.audit_principal_link_keys, public.legal_audit_retention_checkpoints,
  public.legal_audit_log to service_role;
