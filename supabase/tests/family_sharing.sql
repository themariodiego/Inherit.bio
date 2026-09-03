begin;
select plan(85);

-- Two adults, Alpha and Beta, each with a provisioned self subject and an
-- auth session; Gamma is an unrelated account.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('75000000-0000-0000-0000-000000000001', 'family-alpha@example.invalid', '{"display_name":"Alpha"}'),
  ('75000000-0000-0000-0000-000000000002', 'family-beta@example.invalid', '{"display_name":"Beta"}'),
  ('75000000-0000-0000-0000-000000000003', 'family-gamma@example.invalid', '{"display_name":"Gamma"}');
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values
  ('75000000-0000-4000-8000-000000000011', '75000000-0000-0000-0000-000000000001', clock_timestamp(), clock_timestamp(), 'aal1'),
  ('75000000-0000-4000-8000-000000000012', '75000000-0000-0000-0000-000000000002', clock_timestamp(), clock_timestamp(), 'aal1');

create temporary table fx as
select
  '75000000-0000-0000-0000-000000000001'::uuid as alpha,
  '75000000-0000-0000-0000-000000000002'::uuid as beta,
  '75000000-0000-0000-0000-000000000003'::uuid as gamma,
  (select id from public.subjects where subject_account_id = '75000000-0000-0000-0000-000000000001' and subject_class = 'self') as alpha_subject,
  (select id from public.subjects where subject_account_id = '75000000-0000-0000-0000-000000000002' and subject_class = 'self') as beta_subject,
  (select id from public.subject_principals where account_id = '75000000-0000-0000-0000-000000000001' and principal_kind = 'account_subject' and status = 'active') as alpha_principal,
  (select id from public.subject_principals where account_id = '75000000-0000-0000-0000-000000000002' and principal_kind = 'account_subject' and status = 'active') as beta_principal;

-- Schema ----------------------------------------------------------------------
select has_column('public', 'subjects', 'portrait_acknowledged_at', 'subjects.portrait_acknowledged_at exists');
select has_column('public', 'subjects', 'independent_login_at', 'subjects.independent_login_at exists');
select has_column('public', 'condition_registry', 'gene_symbols', 'condition_registry.gene_symbols exists');
select has_table('public', 'family_sharing_pauses', 'the pause store exists');
select has_table('public', 'family_sharing_stops', 'the stop tombstone store exists');
select has_table('public', 'purpose_grant_nonces', 'the single-use nonce store exists');
select is((select count(*) from public.consent_artifacts
  where artifact_key = 'consent.share-with-adult' and version = 1 and superseded_at is null), 1::bigint,
  'the directional sharing artifact is published at version 1');

select throws_ok(
  $$insert into public.condition_registry (
      condition_id, condition_name, category, phenotype_class, registry_revision, gene_symbols
    ) values ('pgtap-bad-symbols', 'Fixture', 'Cancer', 'fixture', 1, array['brca1'])$$,
  '23514', null, 'a lower-case gene symbol is rejected'
);
select lives_ok(
  $$insert into public.condition_registry (
      condition_id, condition_name, category, phenotype_class, registry_revision, inheritance_mode, gene_symbols
    ) values ('pgtap-good-symbols', 'Fixture', 'Cancer', 'fixture', 1, 'autosomal_recessive', array['BRCA1', 'BRCA2'])$$,
  'upper-case gene symbols are accepted'
);
select is((select gene_symbols from public.condition_registry where condition_id = 'pgtap-good-symbols'),
  array['BRCA1', 'BRCA2'], 'gene symbols round-trip');

-- Privileges ------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.grant_directional_purpose_v1(uuid,uuid,uuid,text,text,integer,text)', 'execute'), false,
  'authenticated clients cannot grant a directional purpose directly');
select is(has_function_privilege('anon', 'public.grant_directional_purpose_v1(uuid,uuid,uuid,text,text,integer,text)', 'execute'), false,
  'anon cannot grant a directional purpose');
select is(has_function_privilege('authenticated', 'public.revoke_directional_purpose_v1(uuid,uuid)', 'execute'), false,
  'authenticated clients cannot revoke directly');
select is(has_function_privilege('authenticated', 'public.pause_family_sharing_v1(uuid,uuid)', 'execute'), false,
  'authenticated clients cannot pause directly');
select is(has_function_privilege('authenticated', 'public.resume_family_sharing_v1(uuid,uuid)', 'execute'), false,
  'authenticated clients cannot resume directly');
select is(has_function_privilege('authenticated', 'public.stop_family_sharing_v1(uuid,uuid)', 'execute'), false,
  'authenticated clients cannot stop directly');
select is(has_function_privilege('authenticated', 'public.acknowledge_portrait_v1(uuid,uuid)', 'execute'), false,
  'authenticated clients cannot acknowledge Portrait directly');
select is(has_function_privilege('authenticated', 'public.mark_independent_login_v1(uuid,uuid)', 'execute'), false,
  'authenticated clients cannot stamp the independent-login marker');
select is(has_table_privilege('authenticated', 'public.family_sharing_pauses', 'select'), false,
  'authenticated clients cannot read the pause store');
select is(has_table_privilege('authenticated', 'public.purpose_grant_nonces', 'select'), false,
  'authenticated clients cannot read the nonce store');

-- Grant: wrong account, happy path, nonce reuse --------------------------------
select throws_ok(
  $$select public.grant_directional_purpose_v1(
      (select alpha from fx), (select beta_subject from fx), (select alpha_principal from fx),
      'reports.polygenic', 'consent.share-with-adult', 1, 'nonce-0001-aaaaaaaaaaaaaaaa')$$,
  '42501', 'grant authority is unavailable',
  'an account cannot grant a purpose on another account''s subject'
);
select throws_ok(
  $$select public.grant_directional_purpose_v1(
      (select beta from fx), (select beta_subject from fx), (select beta_principal from fx),
      'reports.polygenic', 'consent.share-with-adult', 1, 'nonce-0002-aaaaaaaaaaaaaaaa')$$,
  '42501', 'grant authority is unavailable',
  'the recipient must be another account''s principal'
);
select throws_ok(
  $$select public.grant_directional_purpose_v1(
      (select beta from fx), (select beta_subject from fx), (select alpha_principal from fx),
      'copilot.cloud', 'consent.share-with-adult', 1, 'nonce-0003-aaaaaaaaaaaaaaaa')$$,
  '22023', 'purpose is not directional',
  'a provider-bound purpose is not a directional grant'
);
select is((select count(*) from public.purpose_grants), 0::bigint,
  'a refused grant writes nothing');

create temporary table polygenic_grant as
select public.grant_directional_purpose_v1(
  (select beta from fx), (select beta_subject from fx), (select alpha_principal from fx),
  'reports.polygenic', 'consent.share-with-adult', 1, 'nonce-0004-aaaaaaaaaaaaaaaa'
) as grant_id;

select isnt((select grant_id from polygenic_grant), null::uuid,
  'the data subject''s own account grants one purpose to one recipient');
select is((select count(*)
  from public.purpose_grants pg
  join public.directional_grants dg
    on dg.grant_id = pg.grant_id and dg.grant_revision = pg.grant_revision
  where pg.grant_id = (select grant_id from polygenic_grant)
    and pg.purpose = 'reports.polygenic'
    and pg.target_kind = 'subject'
    and pg.target_id = (select beta_subject from fx)
    and pg.data_subject_principal_id = (select beta_principal from fx)
    and pg.revoked_at is null
    and dg.recipient_principal_id = (select alpha_principal from fx)
    and dg.recipient_account_id = (select alpha from fx)
    and dg.direction = 'subject_to_recipient'
    and dg.status = 'current'
    and dg.relationship_id is not null
    and dg.pair_id is null), 1::bigint,
  'the base row and the direction row exist at one identical revision');
select is((select count(*) from public.subject_relationships
  where subject_id = (select beta_subject from fx)
    and recipient_principal_id = (select alpha_principal from fx)
    and relationship_kind = 'family_member' and status = 'current'), 1::bigint,
  'a current family_member relationship carries the direction');
select is((select count(*) from public.consent_signatures
  where target_id = (select beta_subject from fx)
    and artifact_key = 'consent.share-with-adult' and purpose = 'reports.polygenic'), 1::bigint,
  'the grant is signed against the exact artifact version');
select is((select count(*) from public.purpose_grant_nonces
  where grant_id = (select grant_id from polygenic_grant)), 1::bigint,
  'the presentation nonce is recorded as consumed');
select is((select count(*) from public.family_pairs), 0::bigint,
  'a report-layer grant creates no pair');

select throws_ok(
  $$select public.grant_directional_purpose_v1(
      (select beta from fx), (select beta_subject from fx), (select alpha_principal from fx),
      'reports.polygenic', 'consent.share-with-adult', 1, 'nonce-0004-aaaaaaaaaaaaaaaa')$$,
  '23505', 'presentation nonce already used',
  'a presentation nonce cannot be used twice'
);
select is(
  public.grant_directional_purpose_v1(
    (select beta from fx), (select beta_subject from fx), (select alpha_principal from fx),
    'reports.polygenic', 'consent.share-with-adult', 1, 'nonce-0005-aaaaaaaaaaaaaaaa'),
  (select grant_id from polygenic_grant),
  'an identical live grant is returned, not duplicated'
);
select is((select count(*) from public.purpose_grants), 1::bigint,
  'exactly one base row exists after the repeat');

-- Pause denies on the next authorisation check ---------------------------------
select is(private.resource_authorized_v1(
  (select alpha from fx), 'subject', (select beta_subject from fx), 'reports.polygenic', 1, 1),
  true, 'the recipient is authorised for the granted purpose');
select is(public.pause_family_sharing_v1((select alpha from fx), (select beta from fx)), 1,
  'either side pauses and the live grant count is reported');
select is(private.resource_authorized_v1(
  (select alpha from fx), 'subject', (select beta_subject from fx), 'reports.polygenic', 1, 1),
  false, 'a paused relationship denies on the next authorisation check');
select is((select revoked_at from public.purpose_grants
  where grant_id = (select grant_id from polygenic_grant)), null::timestamptz,
  'a pause revokes nothing');
select is(public.pause_family_sharing_v1((select beta from fx), (select alpha from fx)), 1,
  'a second pause from the other side is idempotent');
select is((select count(*) from public.family_sharing_pauses where ended_at is null), 1::bigint,
  'one current pause row exists');
select throws_ok(
  $$select public.grant_directional_purpose_v1(
      (select beta from fx), (select beta_subject from fx), (select alpha_principal from fx),
      'ancestry', 'consent.share-with-adult', 1, 'nonce-0006-aaaaaaaaaaaaaaaa')$$,
  '55000', 'family sharing is paused',
  'no new grant is written while sharing is paused'
);
select is(public.resume_family_sharing_v1((select beta from fx), (select alpha from fx)), 1,
  'either side resumes');
select is(private.resource_authorized_v1(
  (select alpha from fx), 'subject', (select beta_subject from fx), 'reports.polygenic', 1, 1),
  true, 'the grant is live again after resume');
select throws_ok(
  $$select public.resume_family_sharing_v1((select beta from fx), (select alpha from fx))$$,
  '55000', 'family sharing is not paused',
  'resume without a pause is refused'
);
select throws_ok(
  $$select public.pause_family_sharing_v1((select alpha from fx), (select gamma from fx))$$,
  '55000', 'no family sharing between these accounts',
  'a pause needs a family counterpart'
);

-- Independent login and the Portrait pair ---------------------------------------
select throws_ok(
  $$select public.grant_directional_purpose_v1(
      (select beta from fx), (select beta_subject from fx), (select alpha_principal from fx),
      'family.portrait', 'consent.share-with-adult', 1, 'nonce-0007-aaaaaaaaaaaaaaaa')$$,
  '55000', 'independent login is required',
  'family.portrait needs the independent-login marker on the data subject'
);
select throws_ok(
  $$select public.mark_independent_login_v1((select beta from fx), '75000000-0000-4000-8000-000000000011')$$,
  '42501', 'auth session is unavailable',
  'another account''s session cannot stamp the marker'
);
select is(public.mark_independent_login_v1((select beta from fx), '75000000-0000-4000-8000-000000000012'), 1,
  'an ordinary sign-in stamps the account''s subjects once');
select is(public.mark_independent_login_v1((select beta from fx), '75000000-0000-4000-8000-000000000012'), 0,
  'a later sign-in is a no-op for the marker');
select is((select subject_binding_revision from public.subjects where id = (select beta_subject from fx)), 1::bigint,
  'the marker transition changes no binding revision');

create temporary table portrait_grant_beta as
select public.grant_directional_purpose_v1(
  (select beta from fx), (select beta_subject from fx), (select alpha_principal from fx),
  'family.portrait', 'consent.share-with-adult', 1, 'nonce-0008-aaaaaaaaaaaaaaaa'
) as grant_id;

create temporary table pair as
select fp.id, fp.pair_revision from public.family_pairs fp
where fp.subject_low_id = least((select alpha_subject from fx), (select beta_subject from fx))
  and fp.subject_high_id = greatest((select alpha_subject from fx), (select beta_subject from fx));

select is((select status from public.family_pairs where id = (select id from pair)), 'pending',
  'the first family.portrait grant creates the pair as pending');
select is(private.resource_authorized_v1(
  (select alpha from fx), 'family_pair', (select id from pair), 'family.portrait', (select pair_revision from pair)),
  false, 'a pending pair authorises nobody');

select is(public.mark_independent_login_v1((select alpha from fx), '75000000-0000-4000-8000-000000000011'), 1,
  'the other account stamps its marker');
create temporary table portrait_grant_alpha as
select public.grant_directional_purpose_v1(
  (select alpha from fx), (select alpha_subject from fx), (select beta_principal from fx),
  'family.portrait', 'consent.share-with-adult', 1, 'nonce-0009-aaaaaaaaaaaaaaaa'
) as grant_id;
select is((select status from public.family_pairs where id = (select id from pair)), 'current',
  'both own-session grants make the pair current');
select is(private.resource_authorized_v1(
  (select beta from fx), 'family_pair', (select id from pair), 'family.portrait', (select pair_revision from pair)),
  true, 'a current pair authorises each subject''s own account');
select ok(public.pause_family_sharing_v1((select beta from fx), (select alpha from fx)) = 3
  and not private.resource_authorized_v1(
    (select alpha from fx), 'family_pair', (select id from pair), 'family.portrait', (select pair_revision from pair)),
  'a pause denies the pair on the next check');
select ok(public.resume_family_sharing_v1((select alpha from fx), (select beta from fx)) = 3
  and private.resource_authorized_v1(
    (select alpha from fx), 'family_pair', (select id from pair), 'family.portrait', (select pair_revision from pair)),
  'resume restores the pair');

-- Portrait acknowledgement -----------------------------------------------------
create temporary table ack as
select public.acknowledge_portrait_v1((select alpha from fx), (select alpha_subject from fx)) as acknowledged_at;
select isnt((select acknowledged_at from ack), null::timestamptz,
  'the caller stamps its own subject');
select is(public.acknowledge_portrait_v1((select alpha from fx), (select alpha_subject from fx)),
  (select acknowledged_at from ack), 'a second acknowledgement returns the first stamp');
select throws_ok(
  $$select public.acknowledge_portrait_v1((select alpha from fx), (select beta_subject from fx))$$,
  '42501', 'portrait acknowledgement authority is unavailable',
  'nobody stamps another account''s subject'
);
select is((select portrait_acknowledged_at from public.subjects where id = (select beta_subject from fx)),
  null::timestamptz, 'the other subject stays unacknowledged');

-- Revoke ----------------------------------------------------------------------
insert into public.portrait_results (
  owner_account_id, parent_a_subject_id, parent_b_subject_id, family_pair_id,
  kind, trait_key, result, coverage, method_version, source_binding_fingerprint,
  computation_revision
) select (select alpha from fx), fp.subject_a_id, fp.subject_b_id, fp.id,
  'carrier_pair', 'abo', '{}'::jsonb, 1, 'pgtap-v1', repeat('1', 64), 1
from public.family_pairs fp where fp.id = (select id from pair);

select throws_ok(
  $$select public.revoke_directional_purpose_v1((select beta from fx), (select grant_id from portrait_grant_alpha))$$,
  '42501', 'grant authority is unavailable',
  'only the data subject''s own account revokes its grant'
);
select isnt(public.revoke_directional_purpose_v1((select alpha from fx), (select grant_id from portrait_grant_alpha)),
  null::timestamptz, 'the granting account revokes');
select is((select count(*)
  from public.purpose_grants pg
  join public.directional_grants dg on dg.grant_id = pg.grant_id
  where pg.grant_id = (select grant_id from portrait_grant_alpha)
    and pg.revoked_at is not null and pg.revocation_reason = 'withdrawn'
    and dg.status = 'revoked' and dg.ended_at is not null), 1::bigint,
  'revocation terminalises both rows together');
select is((select status from public.family_pairs where id = (select id from pair)), 'pending',
  'revoking one Portrait direction returns the pair to pending');
select is((select count(*) from public.portrait_results where family_pair_id = (select id from pair)), 0::bigint,
  'the pair''s Portrait output is deleted on revocation');
select throws_ok(
  $$select public.revoke_directional_purpose_v1((select alpha from fx), (select grant_id from portrait_grant_alpha))$$,
  '42501', 'grant authority is unavailable',
  'an ended grant cannot be revoked twice'
);

-- Stop ------------------------------------------------------------------------
select lives_ok(
  $$select public.grant_directional_purpose_v1(
      (select alpha from fx), (select alpha_subject from fx), (select beta_principal from fx),
      'family.portrait', 'consent.share-with-adult', 1, 'nonce-0010-aaaaaaaaaaaaaaaa')$$,
  'a fresh grant after revocation is accepted'
);
select is((select status from public.family_pairs where id = (select id from pair)), 'current',
  'the pair is current again');

insert into public.portrait_results (
  owner_account_id, parent_a_subject_id, parent_b_subject_id, family_pair_id,
  kind, trait_key, result, coverage, method_version, source_binding_fingerprint,
  computation_revision
) select (select alpha from fx), fp.subject_a_id, fp.subject_b_id, fp.id,
  'carrier_pair', 'rh', '{}'::jsonb, 1, 'pgtap-v1', repeat('2', 64), 1
from public.family_pairs fp where fp.id = (select id from pair);

insert into public.chats (
  id, user_id, title, scope_kind, subject_id, lifecycle_revision,
  provider_classification, runtime_attestation_revision, model_recipient_revision,
  authorization_fingerprint, legacy_unverified
) values (
  '75000000-0000-4000-8000-000000000030', (select alpha from fx), 'Fixture chat', 'self',
  (select alpha_subject from fx), 1, 'local', 1, 1, repeat('a', 64), false
);
insert into public.chat_messages (
  chat_id, user_id, role, content, turn_id, turn_ordinal, paired_role,
  scope_revision, authorization_fingerprint, provider_classification,
  runtime_attestation_revision, model_recipient_revision,
  retrieved_subject_ids, retrieved_purpose_keys, legacy_unverified
) values
  ('75000000-0000-4000-8000-000000000030', (select alpha from fx), 'user', '"q"'::jsonb,
   '75000000-0000-4000-8000-000000000031', 1, 'user', 1, repeat('a', 64), 'local', 1, 1,
   array[(select beta_subject from fx)], array['reports.polygenic'], false),
  ('75000000-0000-4000-8000-000000000030', (select alpha from fx), 'assistant', '"a"'::jsonb,
   '75000000-0000-4000-8000-000000000031', 1, 'assistant', 1, repeat('a', 64), 'local', 1, 1,
   '{}', '{}', false);

select throws_ok(
  $$select * from public.stop_family_sharing_v1((select alpha from fx), (select gamma from fx))$$,
  '55000', 'no family sharing between these accounts',
  'a stop needs a family counterpart'
);

create temporary table stopped as
select * from public.stop_family_sharing_v1((select alpha from fx), (select beta from fx));

select isnt((select ended_at from stopped), null::timestamptz, 'stop returns the ended date');
select is((select deleted_counts from stopped), '{"portrait_results": 1, "chat_messages": 1}'::jsonb,
  'stop returns the itemised deleted counts');
select is((select status from public.family_pairs where id = (select id from pair)), 'revoked',
  'stop revokes the pair');
select is((select pair_revision from public.family_pairs where id = (select id from pair)),
  (select pair_revision from pair) + 1, 'stop bumps the pair revision');
select is((select count(*) from public.purpose_grants where revoked_at is null), 0::bigint,
  'stop revokes every grant both ways');
select is((select count(*) from public.directional_grants where status = 'current'), 0::bigint,
  'every direction row is ended with its base row');
select is((select count(*) from public.subject_relationships
  where relationship_kind = 'family_member' and status = 'current'), 0::bigint,
  'stop ends the family relationships');
select is((select count(*) from public.chat_messages
  where chat_id = '75000000-0000-4000-8000-000000000030'), 1::bigint,
  'only the message built from the other subject is deleted');
select is((select count(*) from public.family_sharing_stops
  where account_low_id = least((select alpha from fx), (select beta from fx))
    and deleted_counts = '{"portrait_results": 1, "chat_messages": 1}'::jsonb), 1::bigint,
  'the tombstone row both accounts read is written');
select is((select count(*) from public.worker_jobs
  where kind = 'revoke_purge' and output_kind = 'lifecycle.revoke-purge'
    and source_binding_kind = 'revocation-disposition' and status = 'queued'
    and payload ->> 'retention_id' = 'purpose.derived-60s'
    and payload ->> 'disposition' = 'family-sharing-stop'), 2::bigint,
  'the purpose.derived-60s purge job is enqueued for each side');
select is(private.resource_authorized_v1(
  (select alpha from fx), 'subject', (select beta_subject from fx), 'reports.polygenic', 1, 1),
  false, 'access ends on the next query after stop');
select throws_ok(
  $$select * from public.stop_family_sharing_v1((select beta from fx), (select alpha from fx))$$,
  '55000', 'no family sharing between these accounts',
  'a second stop has nothing left to act on'
);

-- Marker, per account (D-028): the session an invitation was accepted in ---
-- Gamma opens a session, then accepts an adult-subject invitation from Alpha
-- in it; that session stamps nothing, and neither would an older one.
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values ('75000000-0000-4000-8000-000000000013', (select gamma from fx),
        clock_timestamp() - interval '1 minute', clock_timestamp() - interval '1 minute', 'aal1');
insert into public.subject_invitations (
  target_kind, target_id, inviter_principal_id, invitee_principal_id, email_hmac, token_hash,
  invitation_kind, status, expires_at, accepted_at, terminal_at
) values (
  'subject', (select alpha_subject from fx), (select alpha_principal from fx),
  (select id from public.subject_principals
     where account_id = (select gamma from fx) and principal_kind = 'account_subject' and status = 'active'),
  repeat('a', 64), repeat('b', 64), 'adult_subject', 'accepted',
  clock_timestamp() + interval '1 day', clock_timestamp(), clock_timestamp()
);
select is(public.mark_independent_login_v1((select gamma from fx), '75000000-0000-4000-8000-000000000013'), 0,
  'the session an invitation was accepted in stamps nothing');
select is((select independent_login_at from public.subjects
  where subject_account_id = (select gamma from fx) and subject_class = 'self'), null,
  'the accepting account''s own self record stays unstamped');
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values ('75000000-0000-4000-8000-000000000014', (select gamma from fx),
        clock_timestamp() + interval '1 minute', clock_timestamp() + interval '1 minute', 'aal1');
select is(public.mark_independent_login_v1((select gamma from fx), '75000000-0000-4000-8000-000000000014'), 1,
  'a session opened after the acceptance stamps the account''s self record');
select isnt((select independent_login_at from public.subjects
  where subject_account_id = (select gamma from fx) and subject_class = 'self'), null,
  'the marker is set from the later session');

select * from finish();
rollback;
