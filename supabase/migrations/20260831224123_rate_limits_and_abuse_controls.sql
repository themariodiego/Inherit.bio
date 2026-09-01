-- HMAC-only rate limits and coded abuse controls.

create table public.rate_limit_hmac_buckets (
  bucket_key_hmac text not null check (bucket_key_hmac ~ '^[0-9a-f]{64}$'),
  hmac_key_revision bigint not null check (hmac_key_revision > 0),
  action_id text not null check (action_id ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  window_started_at timestamptz not null,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  request_count integer not null default 0 check (request_count >= 0),
  limit_count integer not null check (limit_count > 0),
  blocked_until timestamptz,
  expires_at timestamptz not null,
  primary key (bucket_key_hmac, hmac_key_revision, action_id, window_started_at),
  check (expires_at > window_started_at)
);

create index rate_limit_hmac_buckets_expiry_idx on public.rate_limit_hmac_buckets (expires_at);

create table public.abuse_events (
  id uuid primary key default gen_random_uuid(),
  audit_principal_id uuid references public.audit_principals (id) on delete restrict,
  event_code text not null check (event_code ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  route_id text,
  outcome_code text not null,
  bucket_key_hmac text check (bucket_key_hmac is null or bucket_key_hmac ~ '^[0-9a-f]{64}$'),
  coded_context jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > occurred_at),
  check (not (coded_context ?| array[
    'ip', 'email', 'name', 'token', 'user_agent', 'genotype', 'variant',
    'message', 'prompt', 'response'
  ]))
);

create index abuse_events_expiry_idx on public.abuse_events (expires_at);

create table public.account_security_states (
  account_id uuid primary key references auth.users (id) on delete restrict,
  security_revision bigint not null default 1 check (security_revision > 0),
  non_self_upload_suspended_at timestamptz,
  active_contradiction_count integer not null default 0 check (active_contradiction_count >= 0),
  failed_reauth_count integer not null default 0 check (failed_reauth_count >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

create or replace function private.consume_rate_limit_v1(
  p_bucket_key_hmac text,
  p_hmac_key_revision bigint,
  p_action_id text,
  p_window_seconds integer,
  p_limit_count integer,
  p_now timestamptz default clock_timestamp()
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_row public.rate_limit_hmac_buckets;
begin
  if p_bucket_key_hmac !~ '^[0-9a-f]{64}$'
    or p_hmac_key_revision < 1
    or p_window_seconds not between 1 and 86400
    or p_limit_count not between 1 and 10000 then
    raise exception using errcode = '22023', message = 'invalid rate limit parameters';
  end if;

  v_window := to_timestamp(floor(extract(epoch from p_now) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limit_hmac_buckets (
    bucket_key_hmac, hmac_key_revision, action_id, window_started_at,
    window_seconds, request_count, limit_count, expires_at
  ) values (
    p_bucket_key_hmac, p_hmac_key_revision, p_action_id, v_window,
    p_window_seconds, 1, p_limit_count, v_window + make_interval(secs => p_window_seconds + 86400)
  )
  on conflict (bucket_key_hmac, hmac_key_revision, action_id, window_started_at)
  do update set request_count = public.rate_limit_hmac_buckets.request_count + 1
  returning * into v_row;

  return query select
    v_row.request_count <= v_row.limit_count,
    greatest(v_row.limit_count - v_row.request_count, 0),
    case when v_row.request_count <= v_row.limit_count then 0
      else greatest(ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - p_now)))::integer, 1)
    end;
end;
$$;

revoke all on function private.consume_rate_limit_v1(text, bigint, text, integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function private.consume_rate_limit_v1(text, bigint, text, integer, integer, timestamptz)
  to service_role;

alter table public.rate_limit_hmac_buckets enable row level security;
alter table public.abuse_events enable row level security;
alter table public.account_security_states enable row level security;
revoke all on table public.rate_limit_hmac_buckets, public.abuse_events,
  public.account_security_states from anon, authenticated;
grant all on table public.rate_limit_hmac_buckets, public.abuse_events,
  public.account_security_states to service_role;
