-- api.embryo-record-key-cards-rights (migration
-- 20261016201000_embryo_record_key_cards_rights). Synthetic accounts, a
-- synthetic published cohort and invented rows only. Everything rolls back.
--
-- The purpose has no issuer, so no session of it can exist on a real
-- database. The first block proves that. The second registers the purpose
-- inside this transaction only, to prove what the consumer does once an
-- issuer exists.
begin;
select no_plan();
\ir fixtures/embryo_cohort_published.inc

create temporary table ids as select
 (select cohort_id from live) cohort,
 (select id from public.subject_principals where account_id='7a000000-0000-0000-0000-000000000002'
   and principal_kind='genetic_parent' and status='active') parent_b,
 (select id from public.subject_principals where account_id='7a000000-0000-0000-0000-000000000001'
   and principal_kind='genetic_parent' and status='active') parent_a,
 (select id from public.subjects where subject_account_id='7a000000-0000-0000-0000-000000000002'
   and subject_class='self' order by created_at limit 1) b_self;

-- A session needs a token hash to hang from; none of the checks below reads
-- it, so the fixture's newest one serves.
create temporary table token as select id from public.token_hashes order by created_at desc limit 1;
select is((select count(*) from token), 1::bigint, 'fixture: a token hash exists for the sessions to reference');

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('rk-rights-test:'||p,'sha256'),'hex') $$;
create function pg_temp.session(p_id uuid, p_principal uuid, p_secret text, p_revision bigint default 1,
 p_expires timestamptz default clock_timestamp() + interval '1 hour') returns uuid language sql volatile as $$
 insert into public.rights_sessions(id, token_hash_id, principal_id, purpose, target_kind, target_id, authority_revision,
  session_hash, expires_at)
 select p_id, (select id from token), p_principal, 'embryo-record-key-card-delivery',
  'cohort-record-key-recipient-set', cohort, p_revision, pg_temp.h(p_secret), p_expires from ids
 returning id $$;
create function pg_temp.deliver(p_secret text, p_nonce text) returns jsonb language sql volatile as $$
 select jsonb_build_object('cohort', d.cohort_id, 'set', d.recipient_set_revision, 'key', d.key_revision, 'cards', d.cards)
 from public.deliver_embryo_record_key_cards_rights_v1(pg_temp.h(p_secret), p_nonce) d $$;

-- Privileges -------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.deliver_embryo_record_key_cards_rights_v1(text,text)', 'execute'), false,
 'an authenticated client cannot deliver cards directly');
select is(has_function_privilege('anon', 'public.deliver_embryo_record_key_cards_rights_v1(text,text)', 'execute'), false,
 'anon cannot deliver cards');
select is(has_function_privilege('service_role', 'public.deliver_embryo_record_key_cards_rights_v1(text,text)', 'execute'), true,
 'only the service role reaches the door');
select is(has_function_privilege('service_role', 'private.embryo_record_key_card_principal_count_v1(uuid,uuid)', 'execute'), false,
 'the authority check is reachable only through the door');

-- Closed until an issuer exists -----------------------------------------------
select is((select count(*) from private.rights_session_purposes where session_purpose='embryo-record-key-card-delivery'), 0::bigint,
 'no issuer has registered the delivery purpose');
select is(private.rights_action_permitted_v1('embryo-record-key-card-delivery', 'deliver-record-key-cards',
 'api.embryo-record-key-cards-rights'), false, 'the purpose matrix refuses the action while no issuer exists');
select throws_ok($$select pg_temp.session('7d300000-0000-4000-8000-000000000011', (select parent_b from ids), 'closed')$$,
 '42501', 'rights purpose unavailable', 'no session of the delivery purpose can be created');
select throws_ok($$select pg_temp.deliver('closed', 'nonce-rk-rights-closed-0001')$$,
 '42501', 'card delivery unavailable', 'with no session the door refuses');

-- What it does once an issuer exists (registered in this transaction only) -------
insert into private.rights_session_purposes(session_purpose, matrix_purpose, invitation_kind, target_kind)
values ('embryo-record-key-card-delivery', 'embryo-record-key-card-delivery', null, 'cohort-record-key-recipient-set');
select pg_temp.session('7d300000-0000-4000-8000-000000000012', (select parent_a from ids), 'account-parent');

select throws_ok($$select pg_temp.deliver('account-parent', 'nonce-rk-rights-account-0001')$$,
 '42501', 'card authority unavailable', 'a recipient with an account collects through the account door, never this one');

-- Parent B becomes a synthetic no-account recipient: same principal, no account.
update public.subject_principals set account_id=null, subject_id=(select b_self from ids) where id=(select parent_b from ids);
select pg_temp.session('7d300000-0000-4000-8000-000000000013', (select parent_b from ids), 'stale-set', 2);
select throws_ok($$select pg_temp.deliver('stale-set', 'nonce-rk-rights-stale-0001')$$,
 '42501', 'card delivery unavailable', 'a session bound to another recipient set revision refuses');
select throws_ok($$select pg_temp.deliver('not-a-session', 'nonce-rk-rights-unknown-001')$$,
 '42501', 'card delivery unavailable', 'an unknown session refuses');
select throws_ok($$select public.deliver_embryo_record_key_cards_rights_v1('not-a-hash', 'nonce-rk-rights-shape-00001')$$,
 '42501', 'card delivery unavailable', 'only a session hash is accepted');
select is((select count(*) from public.future_person_record_key_print_rights pr join public.embryos e on e.id=pr.embryo_id
  where e.cohort_id=(select cohort from ids) and pr.recipient_principal_id=(select parent_b from ids) and pr.status='unconsumed'), 3::bigint,
 'every refusal left the print rights unconsumed');

select pg_temp.session('7d300000-0000-4000-8000-000000000015', (select parent_b from ids), 'current');
-- The purpose matrix is rechecked on every request, not only at session creation.
delete from private.rights_purpose_matrix where purpose='embryo-record-key-card-delivery' and action='deliver-record-key-cards';
select throws_ok($$select pg_temp.deliver('current', 'nonce-rk-rights-matrix-0001')$$,
 '42501', 'card delivery unavailable', 'a session whose action left the matrix refuses');
insert into private.rights_purpose_matrix(purpose, invitation_kind, action, route_id)
values ('embryo-record-key-card-delivery', null, 'deliver-record-key-cards', 'api.embryo-record-key-cards-rights');
create temporary table delivered as select pg_temp.deliver('current', 'nonce-rk-rights-first-00001') body;
select is((select (body->>'cohort')::uuid from delivered), (select cohort from ids), 'the delivery names the session''s cohort');
select is((select jsonb_array_length(body->'cards') from delivered), 3, 'one card per covered embryo');
select ok((select bool_and(c->>'record_key' ~ '^[0-9A-HJKMNP-TV-Z]{20}$') from delivered, jsonb_array_elements(body->'cards') c),
 'each card carries a fresh Record Key');
select is((select count(*) from public.future_person_record_key_hashes h join public.embryos e on e.id=h.embryo_id
  where e.cohort_id=(select cohort from ids) and h.recipient_principal_id=(select parent_b from ids) and h.status='current'
  and h.key_hash in (select encode(extensions.digest(convert_to(c->>'record_key','UTF8'),'sha256'),'hex')
    from delivered, jsonb_array_elements(body->'cards') c)), 3::bigint, 'only each key''s hash is stored');
select is((select count(*) from public.future_person_record_key_print_rights pr join public.embryos e on e.id=pr.embryo_id
  where e.cohort_id=(select cohort from ids) and pr.recipient_principal_id=(select parent_b from ids) and pr.status='consumed'), 3::bigint,
 'the print rights are consumed');
select is((select status from public.rights_sessions where id='7d300000-0000-4000-8000-000000000015'), 'consumed',
 'the session''s one action is spent');
select is((select count(*) from public.legal_audit_log where event_code='embryo.record-key.delivered'
  and route_id='api.embryo-record-key-cards-rights' and coded_context='{"count":3}'::jsonb), 1::bigint, 'the delivery is audited');
select is((select count(*) from public.future_person_record_key_print_rights pr join public.embryos e on e.id=pr.embryo_id
  where e.cohort_id=(select cohort from ids) and pr.recipient_principal_id=(select parent_a from ids) and pr.status='consumed'), 3::bigint,
 'the other parent''s rights are untouched');

select pg_temp.session('7d300000-0000-4000-8000-000000000016', (select parent_b from ids), 'again');
select throws_ok($$select pg_temp.deliver('again', 'nonce-rk-rights-first-00001')$$,
 '23505', 'operation nonce already used', 'a nonce cannot be spent twice');
select throws_ok($$select pg_temp.deliver('again', 'nonce-rk-rights-second-0001')$$,
 '42501', 'no unconsumed print right', 'with every right consumed a fresh session gets nothing');

select * from finish();
rollback;
