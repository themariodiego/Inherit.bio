-- api.consents-revoke-all (migration 20261016200000_consents_revoke_all).
-- Synthetic accounts, a synthetic published cohort and invented rows only.
-- Everything rolls back.
begin;
select no_plan();
\ir fixtures/embryo_cohort_published.inc

-- Two adults for the ordinary grants; the cohort's two parents for the
-- embryo grants (7a...01 with session a1, 7a...02 with session b1).
insert into auth.users (id, email, raw_user_meta_data) values
 ('7c200000-0000-4000-8000-000000000001', 'revoke-all-alpha@example.invalid', '{}'),
 ('7c200000-0000-4000-8000-000000000002', 'revoke-all-beta@example.invalid', '{}');
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
 ('7c200000-0000-4000-8000-000000000011', '7c200000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal1'),
 ('7c200000-0000-4000-8000-000000000012', '7c200000-0000-4000-8000-000000000002', clock_timestamp(), clock_timestamp(), 'aal1');
insert into auth.sessions (id, user_id, created_at, updated_at, aal, not_after) values
 ('7c200000-0000-4000-8000-000000000019', '7c200000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'aal1',
  clock_timestamp() - interval '1 minute');

create temporary table fx as select
 '7c200000-0000-4000-8000-000000000001'::uuid alpha,
 '7c200000-0000-4000-8000-000000000002'::uuid beta,
 '7c200000-0000-4000-8000-000000000011'::uuid alpha_session,
 '7c200000-0000-4000-8000-000000000012'::uuid beta_session,
 '7c200000-0000-4000-8000-000000000019'::uuid alpha_ended_session,
 (select id from public.subjects where subject_account_id='7c200000-0000-4000-8000-000000000001' and subject_class='self') alpha_subject,
 (select id from public.subjects where subject_account_id='7c200000-0000-4000-8000-000000000002' and subject_class='self') beta_subject,
 (select id from public.subject_principals where account_id='7c200000-0000-4000-8000-000000000001' and principal_kind='account_subject' and status='active') alpha_principal,
 (select id from public.subject_principals where account_id='7c200000-0000-4000-8000-000000000002' and principal_kind='account_subject' and status='active') beta_principal,
 (select cohort_id from live) cohort;

-- One current family relationship each way.
insert into public.subject_relationships(id, subject_id, data_subject_principal_id, recipient_principal_id,
 recipient_account_id, relationship_kind, relationship_revision, status)
select '7c200000-0000-4000-8000-000000000021'::uuid, alpha_subject, alpha_principal, beta_principal, beta, 'family_member', 1, 'current' from fx
union all
select '7c200000-0000-4000-8000-000000000022'::uuid, beta_subject, beta_principal, alpha_principal, alpha, 'family_member', 1, 'current' from fx;

-- A directional grant fixture: signature, base row and direction row.
create function pg_temp.grant(p_id uuid, p_signer uuid, p_subject uuid, p_recipient_principal uuid, p_recipient uuid,
 p_relationship uuid, p_purpose text) returns uuid language sql volatile as $$
 insert into public.consent_signatures(id, artifact_key, artifact_version, artifact_body_sha256, signer_principal_id,
  signer_account_id, target_kind, target_id, purpose, statement_keys, jurisdiction_code, jurisdiction_revision, subject_binding_revision)
 select p_id, a.artifact_key, a.version, a.body_sha256, p_signer,
  (select account_id from public.subject_principals where id=p_signer), 'subject', p_subject, p_purpose,
  array['one-purpose'], 'GB', 1, 1
 from public.consent_artifacts a where a.artifact_key='consent.share-with-adult' and a.version=1;
 insert into public.purpose_grants(grant_id, grant_revision, target_kind, target_id, purpose, artifact_key, artifact_version,
  artifact_body_sha256, signature_id, signer_principal_id, data_subject_principal_id, subject_binding_revision,
  jurisdiction_code, jurisdiction_revision)
 select p_id, 1, 'subject', p_subject, p_purpose, s.artifact_key, s.artifact_version, s.artifact_body_sha256, s.id,
  p_signer, p_signer, 1, 'GB', 1 from public.consent_signatures s where s.id=p_id;
 insert into public.directional_grants(grant_id, grant_revision, recipient_principal_id, recipient_account_id,
  relationship_id, relationship_or_pair_revision, direction)
 values (p_id, 1, p_recipient_principal, p_recipient, p_relationship, 1, 'subject_to_recipient');
 select p_id;
$$;
select pg_temp.grant('7c200000-0000-4000-8000-000000000031', alpha_principal, alpha_subject, beta_principal, beta,
 '7c200000-0000-4000-8000-000000000021', 'ancestry') from fx;
select pg_temp.grant('7c200000-0000-4000-8000-000000000032', alpha_principal, alpha_subject, beta_principal, beta,
 '7c200000-0000-4000-8000-000000000021', 'raw.export') from fx;
select pg_temp.grant('7c200000-0000-4000-8000-000000000033', beta_principal, beta_subject, alpha_principal, alpha,
 '7c200000-0000-4000-8000-000000000022', 'ancestry') from fx;
insert into public.consent_grants(id, user_id, provider_key, data_classes) values
 ('7c200000-0000-4000-8000-000000000041', '7c200000-0000-4000-8000-000000000001', 'synthetic-provider', array['genotypes']),
 ('7c200000-0000-4000-8000-000000000042', '7c200000-0000-4000-8000-000000000002', 'synthetic-provider', array['genotypes']);

-- Both parents grant embryo.analysis on the published cohort.
create function pg_temp.grant_analysis(account uuid, session uuid, nonce text) returns uuid language sql as $$
 select public.grant_cohort_purpose_v1(account, session, (select cohort from fx), 'consent.upload-embryo', 1,
  private.embryo_statement_keys_v1('consent.upload-embryo','grant'), decode('deadbeef','hex'), 'GB', nonce); $$;
create temporary table embryo_grants as select
 pg_temp.grant_analysis('7a000000-0000-0000-0000-000000000001', '7a000000-0000-4000-8000-0000000000a1', 'nonce-revoke-all-grant-a') a,
 pg_temp.grant_analysis('7a000000-0000-0000-0000-000000000002', '7a000000-0000-4000-8000-0000000000b1', 'nonce-revoke-all-grant-b') b;

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('revoke-all-test:'||p,'sha256'),'hex') $$;
create function pg_temp.revoke_all(p_account uuid, p_session uuid, p_code text,
 p_expires timestamptz default clock_timestamp() + interval '5 minutes') returns integer language sql volatile as
 $$ select public.revoke_all_own_consents_v1(p_account, p_session, pg_temp.h(p_code), p_expires) $$;
create function pg_temp.current_grants(p_account uuid) returns bigint language sql as $$
 select count(*) from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id
 join public.subject_principals sp on sp.id=pg.signer_principal_id
 where sp.account_id=p_account and pg.revoked_at is null and dg.status='current' $$;

-- Privileges -------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.revoke_all_own_consents_v1(uuid,uuid,text,timestamptz)', 'execute'), false,
 'an authenticated client cannot revoke directly');
select is(has_function_privilege('anon', 'public.revoke_all_own_consents_v1(uuid,uuid,text,timestamptz)', 'execute'), false,
 'anon cannot revoke');
select is(has_function_privilege('service_role', 'public.revoke_all_own_consents_v1(uuid,uuid,text,timestamptz)', 'execute'), true,
 'only the service role reaches the door');
select ok((select pg_get_constraintdef(oid) like '%consents_revoke_all%' and pg_get_constraintdef(oid) like '%account_delete_cancel%'
  and pg_get_constraintdef(oid) like '%other_adult_upload_artifact_sign%'
  from pg_constraint where conrelid='public.account_operation_nonces'::regclass and conname='account_operation_nonces_operation_check'),
 'the nonce store admits the operation and keeps every earlier one');
select is(pg_temp.current_grants((select alpha from fx)), 2::bigint, 'fixture: Alpha signed two current grants');

-- Refusals before any write ----------------------------------------------------
select throws_ok($$select pg_temp.revoke_all((select alpha from fx), (select alpha_ended_session from fx), 'ended')$$,
 '42501', 'revoke-all unavailable', 'an ended auth session cannot revoke');
select throws_ok($$select pg_temp.revoke_all((select alpha from fx), (select beta_session from fx), 'foreign')$$,
 '42501', 'revoke-all unavailable', 'another account''s session cannot revoke');
select throws_ok($$select pg_temp.revoke_all((select alpha from fx), (select alpha_session from fx), 'expired', clock_timestamp() - interval '1 second')$$,
 '22023', 'invalid_operation_nonce', 'an expired nonce is refused');
select throws_ok($$select pg_temp.revoke_all((select alpha from fx), (select alpha_session from fx), 'long', clock_timestamp() + interval '11 minutes')$$,
 '22023', 'invalid_operation_nonce', 'a nonce claiming more than ten minutes is refused');
select throws_ok($$select public.revoke_all_own_consents_v1((select alpha from fx), (select alpha_session from fx), 'not-a-hash', clock_timestamp() + interval '5 minutes')$$,
 '22023', 'invalid_operation_nonce', 'only a nonce''s SHA-256 is accepted');
select throws_ok($$select pg_temp.revoke_all('7c200000-0000-4000-8000-0000000000ff', (select alpha_session from fx), 'unknown')$$,
 '42501', 'revoke-all unavailable', 'an unknown account cannot revoke');

-- An embryo.analysis grant whose signer is not a current required principal
-- of the cohort: the whole request fails and writes nothing.
insert into public.consent_signatures(id, artifact_key, artifact_version, artifact_body_sha256, signer_principal_id,
 signer_account_id, target_kind, target_id, purpose, statement_keys, jurisdiction_code, jurisdiction_revision)
select '7c200000-0000-4000-8000-000000000051', a.artifact_key, a.version, a.body_sha256, f.alpha_principal, f.alpha,
 'cohort', f.cohort, 'embryo.analysis', array['one-purpose'], 'GB', 1
from public.consent_artifacts a cross join fx f where a.artifact_key='consent.upload-embryo' and a.version=1;
insert into public.purpose_grants(grant_id, grant_revision, target_kind, target_id, purpose, artifact_key, artifact_version,
 artifact_body_sha256, signature_id, signer_principal_id, data_subject_principal_id, subject_binding_revision, jurisdiction_code, jurisdiction_revision)
select s.id, 1, 'cohort', s.target_id, 'embryo.analysis', s.artifact_key, s.artifact_version, s.artifact_body_sha256, s.id,
 s.signer_principal_id, s.signer_principal_id, 1, 'GB', 1 from public.consent_signatures s where s.id='7c200000-0000-4000-8000-000000000051';
insert into public.directional_grants(grant_id, grant_revision, recipient_principal_id, recipient_account_id, relationship_or_pair_revision, direction)
select '7c200000-0000-4000-8000-000000000051', 1, alpha_principal, alpha, 1, 'self' from fx;
select throws_ok($$select pg_temp.revoke_all((select alpha from fx), (select alpha_session from fx), 'nonmember')$$,
 '42501', 'revoke-all embryo authority unavailable', 'a non-parent''s embryo grant fails the whole request');
select is(pg_temp.current_grants((select alpha from fx)), 3::bigint, 'the failed request revoked nothing');
select is((select count(*) from public.account_operation_nonces where nonce_hash=pg_temp.h('nonmember')), 0::bigint,
 'the failed request recorded no nonce');
select is((select count(*) from public.consent_grants where user_id=(select alpha from fx) and revoked_at is null), 1::bigint,
 'the failed request kept the provider grant');
delete from public.directional_grants where grant_id='7c200000-0000-4000-8000-000000000051';
delete from public.purpose_grants where grant_id='7c200000-0000-4000-8000-000000000051';
delete from public.consent_signatures where id='7c200000-0000-4000-8000-000000000051';
select is((select count(*) from public.account_operation_nonces where account_id=(select alpha from fx)), 0::bigint,
 'no refused request recorded a nonce');

-- A stale own Copilot grant: its authority is no longer current (Alpha has no
-- Copilot settings), so it authorizes nothing, and revoke-all still ends it.
insert into public.consent_signatures(id, artifact_key, artifact_version, artifact_body_sha256, signer_principal_id,
 signer_account_id, target_kind, target_id, purpose, statement_keys, jurisdiction_code, jurisdiction_revision, subject_binding_revision)
select '7c200000-0000-4000-8000-000000000034', a.artifact_key, a.version, a.body_sha256, f.alpha_principal, f.alpha,
 'subject', f.alpha_subject, 'copilot.local', array['revocable'], 'GB', 1, 1
from public.consent_artifacts a cross join fx f where a.artifact_key='consent.own-copilot-local' and a.version=2;
insert into public.purpose_grants(grant_id, grant_revision, target_kind, target_id, purpose, artifact_key, artifact_version,
 artifact_body_sha256, signature_id, signer_principal_id, data_subject_principal_id, subject_binding_revision, jurisdiction_code,
 jurisdiction_revision, copilot_recipient_revision)
select s.id, 1, 'subject', s.target_id, 'copilot.local', s.artifact_key, s.artifact_version, s.artifact_body_sha256, s.id,
 s.signer_principal_id, s.signer_principal_id, 1, 'GB', 1, 1 from public.consent_signatures s where s.id='7c200000-0000-4000-8000-000000000034';
insert into public.directional_grants(grant_id, grant_revision, recipient_principal_id, recipient_account_id, relationship_or_pair_revision,
 direction, self_principal_revision)
select '7c200000-0000-4000-8000-000000000034', 1, alpha_principal, alpha, 1, 'self', 1 from fx;

-- Alpha turns everything off ---------------------------------------------------
select is(pg_temp.revoke_all((select alpha from fx), (select alpha_session from fx), 'first'), 4,
 'Alpha''s three grants and one provider grant are revoked');
select is((select revoked_at is not null and revocation_reason='withdrawn' from public.purpose_grants
  where grant_id='7c200000-0000-4000-8000-000000000034'), true, 'the stale own Copilot grant is withdrawn');
select is((select status from public.directional_grants where grant_id='7c200000-0000-4000-8000-000000000034'), 'revoked',
 'its direction row ends with it');
select is(pg_temp.current_grants((select alpha from fx)), 0::bigint, 'no grant Alpha signed is current');
select is((select count(*) from public.purpose_grants where grant_id in ('7c200000-0000-4000-8000-000000000031','7c200000-0000-4000-8000-000000000032')
  and revoked_at is not null and revocation_reason='withdrawn'), 2::bigint, 'both base rows are withdrawn');
select is((select count(*) from public.directional_grants where grant_id in ('7c200000-0000-4000-8000-000000000031','7c200000-0000-4000-8000-000000000032')
  and status='revoked' and ended_at is not null), 2::bigint, 'both direction rows end with them');
select is((select revoked_at is null from public.purpose_grants where grant_id='7c200000-0000-4000-8000-000000000033'), true,
 'Beta''s grant to Alpha is another principal''s and stays current');
select is((select count(*) from public.consent_grants where user_id=(select alpha from fx) and revoked_at is not null), 1::bigint,
 'Alpha''s provider grant is revoked');
select is((select count(*) from public.consent_grants where user_id=(select beta from fx) and revoked_at is null), 1::bigint,
 'Beta''s provider grant is untouched');
select is((select count(*) from public.worker_jobs where kind='revoke_purge' and user_id=(select alpha from fx) and status='queued'
  and payload->>'disposition'='purpose-revocation' and payload->>'retention_id'='purpose.derived-60s'
  and payload->>'grant_id' in ('7c200000-0000-4000-8000-000000000031','7c200000-0000-4000-8000-000000000032')), 2::bigint,
 'the purpose.derived-60s purge is queued for each revoked directional grant');
select is((select operation||'|'||session_id::text||'|'||(consumed_at is not null)::text from public.account_operation_nonces
  where nonce_hash=pg_temp.h('first')), 'consents_revoke_all|'||(select alpha_session from fx)::text||'|true',
 'the nonce is recorded once, consumed, with its session and operation');
select is((select count(*) from public.legal_audit_log where event_code='consents.revoked-all' and route_id='api.consents-revoke-all'
  and coded_context=jsonb_build_object('purposes',3,'embryo',0,'providers',1)), 1::bigint, 'one audit batch event closes the request');
select throws_ok($$select pg_temp.revoke_all((select alpha from fx), (select alpha_session from fx), 'first')$$,
 '22023', 'invalid_operation_nonce', 'the same nonce cannot be spent twice');
select is(pg_temp.revoke_all((select alpha from fx), (select alpha_session from fx), 'second'), 0,
 'with nothing left to revoke the request still succeeds');

-- A parent turns their embryo.analysis off --------------------------------------
select is(pg_temp.revoke_all('7a000000-0000-0000-0000-000000000001', '7a000000-0000-4000-8000-0000000000a1', 'parent-a') >= 1, true,
 'the first parent''s revoke-all revokes their own analysis grant');
select is((select revoked_at is not null from public.purpose_grants where grant_id=(select a from embryo_grants)), true,
 'the first parent''s embryo.analysis grant is revoked');
select is((select revoked_at is null from public.purpose_grants where grant_id=(select b from embryo_grants)), true,
 'the second parent''s grant is theirs and stays current');
select is((select count(*) from public.legal_audit_log where event_code='consents.revoked-all'
  and (coded_context->>'embryo')::integer=1), 1::bigint, 'the batch counts the embryo grant');

select * from finish();
rollback;
