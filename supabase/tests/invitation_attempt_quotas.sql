begin;
select plan(58);
-- global-contact-refusal-bar-v1.quotaAuthority (per acting account and per
-- source network) under securityRateLimitContract, enforced inside the
-- invitation RPCs rather than by the route alone. Only synthetic accounts and
-- digests; everything rolls back.
update public.mail_outbox set state='invalidated' where state in ('queued','claimed');

insert into auth.users (id, email)
select ('7f000000-0000-0000-0000-0000000000'||lpad(n::text, 2, '0'))::uuid,
  'quota-'||n||'@example.invalid'
from generate_series(1, 9) n;
create function pg_temp.a(p integer) returns uuid language sql immutable as
 $$ select ('7f000000-0000-0000-0000-0000000000'||lpad(p::text, 2, '0'))::uuid $$;

-- Bucket digests are what the application derives from the account and the
-- source network under the rate-limit key; the database only ever sees these.
create function pg_temp.k(p text) returns text language sql stable as
 $$ select encode(extensions.digest('invitation-quota:'||p,'sha256'),'hex') $$;
create function pg_temp.keys(p_account text, p_network text) returns jsonb language sql stable as
 $$ select jsonb_build_object('1', jsonb_build_object(
   'authenticated-principal', pg_temp.k(p_account), 'source-network', pg_temp.k(p_network))) $$;

-- One adult invitation attempt to a fresh address; the invitation id or null.
create function pg_temp.attempt(p_account uuid, p_keys jsonb) returns uuid
language sql volatile as $$
 select i.invitation_id from public.create_adult_subject_invitation_v1(
  p_account, decode('00112233445566778899aabbccddeeff','hex'),
  encode(extensions.gen_random_bytes(32),'hex'), encode(extensions.gen_random_bytes(32),'hex'),
  true, p_quota_keys => p_keys) i
$$;
create function pg_temp.attempts(p_account uuid, p_keys jsonb, p_count integer) returns integer
language plpgsql volatile as $$
declare v_issued integer := 0;
begin
 for i in 1..p_count loop
  if pg_temp.attempt(p_account, p_keys) is not null then v_issued := v_issued + 1; end if;
 end loop;
 return v_issued;
end;
$$;
create function pg_temp.bucket(p_key text, p_window integer, p_dimension text default 'authenticated-principal')
returns public.rate_limit_hmac_buckets language sql stable as $$
 select b.* from public.rate_limit_hmac_buckets b
 where b.action_id='global-contact-refusal-bar-v1.invitation-attempt'
  and b.bucket_key_hmac=p_key and b.dimension=p_dimension and b.window_seconds=p_window
 order by b.window_started_at desc limit 1
$$;

-- ---------------------------------------------------------------------------
-- The quota is part of the RPC: no keys, no invitation.
select throws_ok($$select * from public.create_adult_subject_invitation_v1(
 pg_temp.a(1), decode('00112233445566778899aabbccddeeff','hex'), repeat('a',64), repeat('b',64), true)$$,
 '55000', 'rate limit keys required', 'an adult invitation without quota keys is refused');
select throws_ok($$select * from public.create_adult_subject_invitation_v1(
 pg_temp.a(1), decode('00112233445566778899aabbccddeeff','hex'), repeat('a',64), repeat('b',64), true,
 p_quota_keys => jsonb_build_object('1', jsonb_build_object('source-network', pg_temp.k('a1'))))$$,
 '55000', 'rate limit keys required', 'a key set without the account dimension is refused');
select throws_ok($$select * from public.create_adult_subject_invitation_v1(
 pg_temp.a(1), decode('00112233445566778899aabbccddeeff','hex'), repeat('a',64), repeat('b',64), true,
 p_quota_keys => jsonb_build_object('1', jsonb_build_object('authenticated-principal', pg_temp.k('a1'))))$$,
 '55000', 'rate limit keys required', 'a key set without the network dimension is refused');
select throws_ok($$select * from public.create_adult_subject_invitation_v1(
 pg_temp.a(1), decode('00112233445566778899aabbccddeeff','hex'), repeat('a',64), repeat('b',64), true,
 p_quota_keys => jsonb_build_object('1', jsonb_build_object(
  'authenticated-principal', pg_temp.a(1)::text, 'source-network', '192.0.2.1')))$$,
 '55000', 'rate limit keys required', 'a raw account id or address is not a bucket key');
select throws_ok($$select * from public.create_embryo_draft_invitation_v1(
 pg_temp.a(1), gen_random_uuid(), gen_random_uuid(), repeat('a',64), repeat('b',64),
 'quota-no-keys-nonce-aaaaaaaa', true)$$,
 '55000', 'rate limit keys required', 'a co-parent invitation without quota keys is refused');
select is((select count(*) from public.subjects
 where owner_account_id=pg_temp.a(1) and subject_class='other_adult'), 0::bigint,
 'the refused calls wrote no subject');

-- ---------------------------------------------------------------------------
-- Per acting account: 10 an hour.
select is(pg_temp.attempts(pg_temp.a(1), pg_temp.keys('a1','n1'), 1), 1, 'a first attempt is issued');
create temporary table first_bucket as select * from pg_temp.bucket(pg_temp.k('a1'), 3600);
select is(pg_temp.attempts(pg_temp.a(1), pg_temp.keys('a1','n1'), 9), 9,
 'ten attempts in an hour are all issued');
select is(pg_temp.attempt(pg_temp.a(1), pg_temp.keys('a1','n1')), null::uuid,
 'the eleventh attempt in the hour is not issued');
select is((select count(*) from public.subjects
 where owner_account_id=pg_temp.a(1) and subject_class='other_adult'), 10::bigint,
 'the refused attempt reserved no subject or draft');
select is((select count(*) from public.subject_invitations si
 join public.subject_principals sp on sp.id=si.inviter_principal_id
 where sp.account_id=pg_temp.a(1)), 10::bigint, 'the refused attempt wrote no invitation');
select is((select request_count||':'||outcome_code from pg_temp.bucket(pg_temp.k('a1'), 3600)),
 '11:exhausted', 'the refused attempt is still counted, and the bucket records only a coded outcome');
select is((select request_count||':'||outcome_code from pg_temp.bucket(pg_temp.k('a1'), 86400)),
 '11:allowed', 'the daily bucket counts the same attempts');
select is((select first_attempt_at from pg_temp.bucket(pg_temp.k('a1'), 3600)),
 (select first_attempt_at from first_bucket), 'later attempts never move the first-attempt clock');
select is((select expires_at from pg_temp.bucket(pg_temp.k('a1'), 3600)),
 (select expires_at from first_bucket), 'later attempts never renew the fixed purge time');
select ok((select expires_at = window_started_at + interval '1 hour'
  and expires_at <= first_attempt_at + interval '24 hours'
 from first_bucket), 'an hourly bucket purges at the end of its hour, within 24 hours');
select ok((select expires_at <= first_attempt_at + interval '24 hours'
  and expires_at = date_trunc('day', window_started_at at time zone 'UTC') at time zone 'UTC' + interval '1 day'
 from pg_temp.bucket(pg_temp.k('a1'), 86400)),
 'a daily bucket is the UTC day and purges at its end');
select ok(pg_temp.attempt(pg_temp.a(2), pg_temp.keys('a2','n2')) is not null,
 'another account keeps its own quota');
select is(pg_temp.attempt(pg_temp.a(1), pg_temp.keys('a1','n9')), null::uuid,
 'moving to another network does not reset the account quota');
select is((select invitation_id from public.create_embryo_draft_invitation_v1(
 pg_temp.a(1), gen_random_uuid(), gen_random_uuid(), repeat('a',64), repeat('b',64),
 'quota-exhausted-nonce-aaaaaaa', true, p_quota_keys => pg_temp.keys('a1','n1'))), null::uuid,
 'the co-parent path shares the same quota and stops before any draft is read');
select is((select count(*) from public.embryo_operation_nonces
 where nonce_hash=encode(extensions.digest('quota-exhausted-nonce-aaaaaaa','sha256'),'hex')), 0::bigint,
 'an exhausted attempt consumes no operation nonce');
select is((select invitation_id from public.create_adult_subject_invitation_v1(
 pg_temp.a(1), decode('00112233445566778899aabbccddeeff','hex'), pg_temp.k('exhausted-contact'),
 repeat('d',64), true, p_quota_keys => pg_temp.keys('a1','n1'))), null::uuid,
 'an exhausted account cannot invite a named address either');
select is((select count(*) from public.subject_invitations where email_hmac=pg_temp.k('exhausted-contact'))
 + (select count(*) from public.contact_refusal_bars where contact_hmac=pg_temp.k('exhausted-contact'))
 + (select count(*) from public.invitation_refusal_hmacs where email_hmac=pg_temp.k('exhausted-contact')),
 0::bigint, 'the exhausted attempt writes no invitation and no bar for that address');

-- ---------------------------------------------------------------------------
-- Per source network: 30 an hour, across accounts.
select is(pg_temp.attempts(pg_temp.a(3), pg_temp.keys('a3','n3'), 10)
 + pg_temp.attempts(pg_temp.a(4), pg_temp.keys('a4','n3'), 10)
 + pg_temp.attempts(pg_temp.a(5), pg_temp.keys('a5','n3'), 9), 29,
 'twenty-nine attempts from one network are issued across three accounts');
-- a2 made one attempt from n2 above; the thirtieth from n3 comes from a2 too.
select ok(pg_temp.attempt(pg_temp.a(2), pg_temp.keys('a2','n3')) is not null,
 'the thirtieth attempt from that network is issued');
select is(pg_temp.attempt(pg_temp.a(9), pg_temp.keys('a9','n3')), null::uuid,
 'a thirty-first attempt from that network is not issued, even from a fresh account');
select is((select request_count||':'||outcome_code from pg_temp.bucket(pg_temp.k('n3'), 3600, 'source-network')),
 '31:exhausted', 'the network refusal is counted in the network bucket');
select is((select request_count||':'||outcome_code from pg_temp.bucket(pg_temp.k('a9'), 3600)),
 '1:allowed', 'while the fresh account''s own bucket would have allowed it');
select ok(pg_temp.attempt(pg_temp.a(9), pg_temp.keys('a9','n4')) is not null,
 'the same fresh account is issued from another network');
select ok((select expires_at = window_started_at + interval '1 hour'
 from pg_temp.bucket(pg_temp.k('n3'), 3600, 'source-network')),
 'a network bucket purges at the end of its hour');

-- ---------------------------------------------------------------------------
-- Per acting account: 30 a UTC day.
insert into public.rate_limit_hmac_buckets (bucket_key_hmac, hmac_key_revision, action_id, dimension,
 window_started_at, window_seconds, request_count, limit_count, first_attempt_at, expires_at, outcome_code)
select pg_temp.k('a6'), 1, 'global-contact-refusal-bar-v1.invitation-attempt', 'authenticated-principal',
 w, 86400, 30, 30, greatest(w, clock_timestamp() - interval '1 minute'), w + interval '1 day', 'allowed'
from (select to_timestamp(floor(extract(epoch from clock_timestamp()) / 86400) * 86400) w) x;
select is(pg_temp.attempt(pg_temp.a(6), pg_temp.keys('a6','n6')), null::uuid,
 'an account with thirty attempts today is not issued a thirty-first');
select is((select request_count||':'||outcome_code from pg_temp.bucket(pg_temp.k('a6'), 86400)),
 '31:exhausted', 'the daily refusal is counted');
select is((select request_count||':'||outcome_code from pg_temp.bucket(pg_temp.k('a6'), 3600)),
 '1:allowed', 'the hourly bucket alone would have allowed it');

-- ---------------------------------------------------------------------------
-- The bucket row is the contract's shape and nothing more.
select is((select array_agg(column_name::text order by column_name)
 from information_schema.columns where table_schema='public' and table_name='rate_limit_hmac_buckets'),
 array['action_id','bucket_key_hmac','dimension','expires_at','first_attempt_at','hmac_key_revision',
  'limit_count','outcome_code','request_count','window_seconds','window_started_at'],
 'a bucket holds only the namespace, key revision, digest, counters, clock and coded outcome');
select throws_ok($$insert into public.rate_limit_hmac_buckets (bucket_key_hmac, hmac_key_revision,
 action_id, dimension, window_started_at, window_seconds, request_count, limit_count,
 first_attempt_at, expires_at, outcome_code)
 values (repeat('c',64), 1, 'global-contact-refusal-bar-v1.invitation-attempt', 'authenticated-principal',
 date_trunc('day', clock_timestamp()), 86400, 1, 30, date_trunc('day', clock_timestamp()),
 date_trunc('day', clock_timestamp()) + interval '25 hours', 'allowed')$$,
 '23514', null, 'no bucket may be kept past 24 hours from its first attempt');
select ok((select bool_and(bucket_key_hmac ~ '^[0-9a-f]{64}$') from public.rate_limit_hmac_buckets),
 'every stored bucket key is a keyed digest');

-- ---------------------------------------------------------------------------
-- Rate-limit key rotation keeps counting and never restarts a window.
select is(pg_temp.attempts(pg_temp.a(7), pg_temp.keys('a7','n7'), 10), 10,
 'a seventh account uses its hourly quota under revision 1');
select lives_ok($$select private.begin_hmac_key_rotation_v1('rate-limit', 2)$$,
 'the operator rotates the rate-limit key');
select throws_ok($$select pg_temp.attempt(pg_temp.a(8), pg_temp.keys('a8','n8'))$$,
 '55000', 'rate limit keys required', 'after rotation every usable revision must be presented');
create function pg_temp.keys2(p_account text, p_network text) returns jsonb language sql stable as
 $$ select pg_temp.keys(p_account, p_network) || jsonb_build_object('2', jsonb_build_object(
   'authenticated-principal', pg_temp.k(p_account||'@2'), 'source-network', pg_temp.k(p_network||'@2'))) $$;
select is(pg_temp.attempt(pg_temp.a(7), pg_temp.keys2('a7','n7')), null::uuid,
 'rotation does not give an exhausted account a fresh window');
select is((select request_count from pg_temp.bucket(pg_temp.k('a7'), 3600)), 11,
 'the revision-1 bucket keeps counting until its fixed purge');
select ok(pg_temp.attempt(pg_temp.a(8), pg_temp.keys2('a8','n8')) is not null,
 'a new account is issued after rotation');
select is((select array_agg(distinct hmac_key_revision) from public.rate_limit_hmac_buckets
 where bucket_key_hmac in (pg_temp.k('a8'), pg_temp.k('a8@2'), pg_temp.k('n8'), pg_temp.k('n8@2'))),
 array[2::bigint], 'new buckets are created under the active revision only');
select throws_ok($$select private.retire_hmac_key_version_v1('rate-limit', 1)$$,
 '55000', 'key revision still protects live rows',
 'the old rate-limit key cannot retire before its last bucket purges');

-- Let every revision-1 bucket reach its purge time, as the hour would.
update public.rate_limit_hmac_buckets set
 window_started_at = window_started_at - interval '1000 days',
 first_attempt_at = window_started_at - interval '1000 days',
 expires_at = window_started_at - interval '1000 days' + interval '1 second'
where hmac_key_revision = 1;
create temporary table before_purge as select
 (select count(*) from public.rate_limit_hmac_buckets where expires_at <= clock_timestamp()) expired,
 (select count(*) from public.rate_limit_hmac_buckets where expires_at > clock_timestamp()) live;
select lives_ok($$select private.retire_hmac_key_version_v1('rate-limit', 1)$$,
 'the old rate-limit key retires after its last bucket''s purge time');
select is(public.purge_expired_rate_limit_buckets_v1(), (select expired::integer from before_purge),
 'the purge deletes exactly the buckets past their fixed purge time');
select is((select count(*) from public.rate_limit_hmac_buckets), (select live from before_purge),
 'unexpired buckets remain');

-- ---------------------------------------------------------------------------
-- Privileges.
select ok(has_function_privilege('service_role', 'public.purge_expired_rate_limit_buckets_v1()', 'execute')
 and not has_function_privilege('anon', 'public.purge_expired_rate_limit_buckets_v1()', 'execute')
 and not has_function_privilege('authenticated', 'public.purge_expired_rate_limit_buckets_v1()', 'execute'),
 'only the service role runs the bucket purge');
select ok(not has_function_privilege(r, 'private.consume_rate_limit_buckets_v1(text,jsonb,jsonb)', 'execute')
 and not has_function_privilege(r, 'private.consume_invitation_attempt_quota_v1(jsonb)', 'execute'),
 r||' cannot count or reset a bucket directly')
from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_table_privilege(r, 'public.rate_limit_hmac_buckets', 'select'),
 r||' cannot read the buckets')
from unnest(array['anon','authenticated']) r;
select ok(not has_table_privilege('service_role', 'public.rate_limit_hmac_buckets', p),
 'the service role cannot '||p||' a bucket, so it cannot reset a quota')
from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p;
set local role service_role;
select throws_ok($$delete from public.rate_limit_hmac_buckets$$, '42501', null,
 'a service caller cannot erase the counters');
reset role;

select * from finish();
rollback;
