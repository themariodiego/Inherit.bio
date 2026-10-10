begin;
select plan(50);
-- api.future-person-claim, the public start of a Future Person claim
-- (future-person-claim-resolution-v1.publicIntake, abuseControls,
-- future-person.claim-intake-session-24h). Synthetic digests only; the
-- database never sees an address, name, date or key. Everything rolls back.

-- The rolled-back transaction owns the table for the length of this suite.
delete from private.future_person_claim_intakes;
delete from public.rate_limit_hmac_buckets where action_id = 'api.future-person-claim';

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('claim-intake-test:'||p,'sha256'),'hex') $$;
create function pg_temp.set1(p text) returns jsonb language sql immutable as
 $$ select jsonb_build_object('1', pg_temp.h(p)) $$;
create function pg_temp.blob(p integer) returns bytea language sql volatile as
 $$ select extensions.gen_random_bytes(p) $$;

-- One start; mode, identifier and network chosen by the caller.
create function pg_temp.start(p_mode text, p_identifier text, p_network text, p_tag text default null)
returns text language sql volatile as $$
 select public.start_future_person_claim_v1(
  pg_temp.h('session:'||coalesce(p_tag, gen_random_uuid()::text)),
  pg_temp.h('nonce:'||coalesce(p_tag, gen_random_uuid()::text)),
  p_mode,
  case when p_mode = 'keyless-start' then null else pg_temp.h('key:'||p_identifier) end,
  pg_temp.blob(64), pg_temp.blob(60),
  pg_temp.set1('identifier:'||p_identifier), pg_temp.set1('network:'||p_network))
$$;
create function pg_temp.audit_count() returns bigint language sql stable as
 $$ select count(*) from public.legal_audit_log where event_code like 'claim.intake.%' $$;
create temporary table audit_before as select pg_temp.audit_count() n;

-- ---------------------------------------------------------------------------
-- Every mode starts the same way, and nothing looks for a record.
select is(pg_temp.start('record-key', 'k1', 'n1', 'first'), 'received', 'a Record Key start is received');
select is(pg_temp.start('claimant-recovery-key', 'r1', 'n2'), 'received', 'a Recovery Key start is received');
select is(pg_temp.start('keyless-start', 'c1', 'n3'), 'received', 'a keyless start is received');
select is((select array_agg(mode order by mode) from private.future_person_claim_intakes),
  array['claimant-recovery-key', 'keyless-start', 'record-key'],
  'each start is one intake with its mode stored on the server');
select ok(not exists (select 1 from pg_proc where proname = 'start_future_person_claim_v1'
  and prosrc ~ '(public|private)\.(future_person_(record_key|recovery_key|identity|claimant|claims|claim_sessions|claim_documents|claim_review)|embryo|subject)'),
  'the start reads no record, key, profile, claimant, embryo or subject table');
select is((select count(*) from private.future_person_claim_intakes
  where (mode = 'keyless-start') = (key_hash is null)), 3::bigint,
  'only the key modes store a key hash, and only its hash');
select ok((select expires_at = created_at + interval '24 hours' and last_active_at = created_at
  from private.future_person_claim_intakes where session_hash = pg_temp.h('session:first')),
  'an intake lives 24 hours from its start and no longer');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
  where table_schema = 'private' and table_name = 'future_person_claim_intakes'),
  array['completed_at','created_at','expires_at','form_nonce_hash','id','identifier_hmac','identifier_key_revision',
    'identity_ciphertext','identity_key_shredded_at','key_hash','last_active_at','mode','network_hmac','network_key_revision',
    'session_hash','wrapped_data_key'],
  'an intake holds hashes, digests, ciphertext and times, and no plaintext column');
select is(pg_temp.audit_count() - (select n from audit_before), 3::bigint,
  'each received start appends one coded ledger event');
select is((select count(*) from public.legal_audit_log where event_code = 'claim.intake.started'
  and coded_context <> '{}'::jsonb), 0::bigint, 'the event records no mode, key or identity');

-- ---------------------------------------------------------------------------
-- Refusals of shape.
select throws_ok($$select public.start_future_person_claim_v1(pg_temp.h('s'), pg_temp.h('n'),
  'keyless-start', pg_temp.h('key'), pg_temp.blob(64), pg_temp.blob(60), pg_temp.set1('i'), pg_temp.set1('n'))$$,
  '22023', 'claim intake invalid', 'a keyless start carries no key');
select throws_ok($$select public.start_future_person_claim_v1(pg_temp.h('s'), pg_temp.h('n'),
  'record-key', null, pg_temp.blob(64), pg_temp.blob(60), pg_temp.set1('i'), pg_temp.set1('n'))$$,
  '22023', 'claim intake invalid', 'a key start carries its key hash');
select throws_ok($$select public.start_future_person_claim_v1(pg_temp.h('s'), pg_temp.h('n'),
  'guess', null, pg_temp.blob(64), pg_temp.blob(60), pg_temp.set1('i'), pg_temp.set1('n'))$$,
  '22023', 'claim intake invalid', 'an unknown mode is refused');
select throws_ok($$select public.start_future_person_claim_v1('plain-session', pg_temp.h('n'),
  'keyless-start', null, pg_temp.blob(64), pg_temp.blob(60), pg_temp.set1('i'), pg_temp.set1('n'))$$,
  '22023', 'claim intake invalid', 'a session credential is stored only as a hash');
select throws_ok($$select public.start_future_person_claim_v1(pg_temp.h('s'), pg_temp.h('n'),
  'keyless-start', null, convert_to('Plain Name','UTF8'), pg_temp.blob(60), pg_temp.set1('i'), pg_temp.set1('n'))$$,
  '22023', 'claim intake invalid', 'identity that is too short to be ciphertext is refused');
select throws_ok($$select public.start_future_person_claim_v1(pg_temp.h('s'), pg_temp.h('n'),
  'keyless-start', null, pg_temp.blob(64), pg_temp.blob(60), null, pg_temp.set1('n'))$$,
  '55000', 'rate limit keys required', 'a start without its identifier digest is refused');
select throws_ok($$select public.start_future_person_claim_v1(pg_temp.h('s'), pg_temp.h('n'),
  'keyless-start', null, pg_temp.blob(64), pg_temp.blob(60), pg_temp.set1('i'),
  jsonb_build_object('1', '192.0.2.1'))$$,
  '22023', 'keyed digest set invalid', 'a raw network address is not a digest');
select throws_ok($$select pg_temp.start('record-key', 'k9', 'n9', 'first')$$,
  '23505', 'claim form already used', 'a replayed form is refused, not answered with a second session');

-- ---------------------------------------------------------------------------
-- Identifier: one live intake, three starts a UTC day.
select is(pg_temp.start('record-key', 'k1', 'n4'), 'capacity_limited',
  'a second live intake for the same key is limited');
select is(pg_temp.start('keyless-start', 'k1', 'n4'), 'capacity_limited',
  'the identifier limit does not depend on the mode submitted');
select is(pg_temp.start('record-key', 'k2', 'n4'), 'received', 'another key is received');
insert into public.rate_limit_hmac_buckets (bucket_key_hmac, hmac_key_revision, action_id, dimension,
 window_started_at, window_seconds, request_count, limit_count, first_attempt_at, expires_at, outcome_code)
select pg_temp.h('identifier:k3'), 1, 'api.future-person-claim', 'token-or-key-hmac',
 w, 86400, 3, 3, greatest(w, clock_timestamp() - interval '1 minute'), w + interval '1 day', 'allowed'
from (select to_timestamp(floor(extract(epoch from clock_timestamp()) / 86400) * 86400) w) x;
select is(pg_temp.start('record-key', 'k3', 'n5'), 'capacity_limited',
  'a key with three starts today is limited');

-- Network: three live intakes, ten starts in 15 minutes, forty a UTC day.
select is(pg_temp.start('keyless-start', 'c2', 'n6'), 'received', 'network n6, first live intake');
select is(pg_temp.start('keyless-start', 'c3', 'n6'), 'received', 'second');
select is(pg_temp.start('keyless-start', 'c4', 'n6'), 'received', 'third');
select is(pg_temp.start('keyless-start', 'c5', 'n6'), 'capacity_limited',
  'a fourth live intake from one network is limited');
insert into public.rate_limit_hmac_buckets (bucket_key_hmac, hmac_key_revision, action_id, dimension,
 window_started_at, window_seconds, request_count, limit_count, first_attempt_at, expires_at, outcome_code)
select pg_temp.h('network:n7'), 1, 'api.future-person-claim', 'source-network',
 w, 900, 10, 10, greatest(w, clock_timestamp() - interval '1 second'), w + interval '15 minutes', 'allowed'
from (select to_timestamp(floor(extract(epoch from clock_timestamp()) / 900) * 900) w) x;
select is(pg_temp.start('keyless-start', 'c6', 'n7'), 'capacity_limited',
  'an eleventh start in 15 minutes from one network is limited');
insert into public.rate_limit_hmac_buckets (bucket_key_hmac, hmac_key_revision, action_id, dimension,
 window_started_at, window_seconds, request_count, limit_count, first_attempt_at, expires_at, outcome_code)
select pg_temp.h('network:n8'), 1, 'api.future-person-claim', 'source-network',
 w, 86400, 40, 40, greatest(w, clock_timestamp() - interval '1 minute'), w + interval '1 day', 'allowed'
from (select to_timestamp(floor(extract(epoch from clock_timestamp()) / 86400) * 86400) w) x;
select is(pg_temp.start('keyless-start', 'c7', 'n8'), 'capacity_limited',
  'a forty-first start in a UTC day from one network is limited');

create temporary table limited_state as select
 (select count(*) from private.future_person_claim_intakes) intakes, pg_temp.audit_count() audits;
select is(pg_temp.start('keyless-start', 'c5', 'n6'), 'capacity_limited', 'a limited start');
select is((select count(*) from private.future_person_claim_intakes), (select intakes from limited_state),
  'a limited start writes no intake');
select is(pg_temp.audit_count(), (select audits from limited_state), 'and no ledger event');
select ok((select request_count > 0 from public.rate_limit_hmac_buckets
  where action_id = 'api.future-person-claim' and bucket_key_hmac = pg_temp.h('identifier:c5')
    and dimension = 'normalized-identifier'),
  'but it is still counted before anything else is decided');

-- Global: at most 500 live cases.
insert into private.future_person_claim_intakes (session_hash, form_nonce_hash, mode, key_hash,
 identity_ciphertext, wrapped_data_key, identifier_hmac, identifier_key_revision, network_hmac,
 network_key_revision, created_at, last_active_at, expires_at)
select pg_temp.h('bulk-s'||g), pg_temp.h('bulk-n'||g), 'keyless-start', null, pg_temp.blob(64), pg_temp.blob(60),
 pg_temp.h('bulk-i'||g), 1, pg_temp.h('bulk-net'||g), 1, now_at, now_at, now_at + interval '24 hours'
from generate_series(1, 500 - (select count(*) from private.future_person_claim_intakes)) g,
 (select clock_timestamp() now_at) t;
select is(pg_temp.start('keyless-start', 'c8', 'n9'), 'capacity_limited',
  'a start past 500 live cases is limited, whatever its key or network');

-- ---------------------------------------------------------------------------
-- Lifetime: 24 hours absolute, 30 minutes idle, never extended.
select throws_ok($$update private.future_person_claim_intakes set expires_at = expires_at + interval '1 hour'
  where session_hash = pg_temp.h('session:first')$$, '23514', null, 'the absolute deadline cannot be extended');
select ok((private.current_claim_intake_v1(pg_temp.h('session:first'))).id is not null,
  'a fresh intake is live');
update private.future_person_claim_intakes set
  created_at = created_at - interval '31 minutes', expires_at = expires_at - interval '31 minutes',
  last_active_at = last_active_at - interval '31 minutes'
where session_hash = pg_temp.h('session:first');
select ok((private.current_claim_intake_v1(pg_temp.h('session:first'))).id is null,
  'thirty idle minutes end it');
select ok((private.current_claim_intake_v1(pg_temp.h('no-such-session'))).id is null,
  'an unknown credential names nothing');
update private.future_person_claim_intakes set
  created_at = x.t - interval '25 hours', expires_at = x.t - interval '1 hour',
  last_active_at = x.t - interval '25 hours'
from (select clock_timestamp() t) x
where session_hash in (pg_temp.h('bulk-s1'), pg_temp.h('bulk-s2'));
create temporary table live_before as select count(*) n from private.future_person_claim_intakes i
 where private.claim_intake_live_v1(i);
select is(public.purge_future_person_claim_intakes_v1(), 3,
  'the purge deletes the two expired intakes and the idle one');
select is((select count(*) from private.future_person_claim_intakes), (select n from live_before),
  'and keeps every live intake');
select is((select coded_context from public.legal_audit_log where event_code = 'claim.intake.expired'
  order by seq desc limit 1), '{"count": 3}'::jsonb, 'the purge records only a count');
select is(pg_temp.start('keyless-start', 'c8', 'n9'), 'received',
  'the purged intakes free their share of the global capacity');

-- ---------------------------------------------------------------------------
-- Rotation: an unexpired intake keeps its rate-limit revision from retiring,
-- so a rotation cannot lift the one-live-intake limit early.
select private.begin_hmac_key_rotation_v1('rate-limit', 2);
delete from public.rate_limit_hmac_buckets;
select throws_ok($$select private.retire_hmac_key_version_v1('rate-limit', 1)$$, '55000',
  'key revision still protects live rows',
  'a rate-limit revision cannot retire while an intake written under it is unexpired');
update private.future_person_claim_intakes set
  created_at = x.t - interval '25 hours', expires_at = x.t - interval '1 hour',
  last_active_at = x.t - interval '25 hours'
from (select clock_timestamp() t) x;
select lives_ok($$select private.retire_hmac_key_version_v1('rate-limit', 1)$$,
  'once every intake under it has expired, it retires');
select is((select state from private.hmac_key_versions where keyring = 'rate-limit' and key_revision = 1),
  'retired', 'and matches nothing from then on');

-- ---------------------------------------------------------------------------
-- Privileges.
select ok(has_function_privilege('service_role', f, 'execute')
  and not has_function_privilege('anon', f, 'execute')
  and not has_function_privilege('authenticated', f, 'execute'), 'only the service role calls '||f)
from unnest(array['public.start_future_person_claim_v1(text,text,text,text,bytea,bytea,jsonb,jsonb)',
  'public.purge_future_person_claim_intakes_v1()']) f;
select ok(not has_table_privilege(r, 'private.future_person_claim_intakes', 'select'),
  r||' cannot read an intake')
from unnest(array['anon','authenticated','service_role']) r;
select is((select count(*) from public.purge_target_stores
  where store_name = 'private.future_person_claim_intakes'), 1::bigint,
  'the intake store is in the purge register');

select * from finish();
rollback;
