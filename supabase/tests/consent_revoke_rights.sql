-- api.consent-revoke-rights (migration 20261016202000_consent_revoke_rights).
-- Synthetic accounts and invented rows only. Everything rolls back.
--
-- The adult-subject-control purpose has no issuer, so no session of it can
-- exist on a real database. The first block proves that. The second block
-- registers the purpose inside this transaction only, to prove what the door
-- does once an issuer exists.
begin;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
 ('7e400000-0000-4000-8000-000000000001', 'revoke-rights-uploader@example.invalid', '{}'),
 ('7e400000-0000-4000-8000-000000000002', 'revoke-rights-other@example.invalid', '{}');

\ir fixtures/synthetic_rights_token.inc
create temporary table fx as select
 '7e400000-0000-4000-8000-000000000001'::uuid uploader,
 '7e400000-0000-4000-8000-000000000002'::uuid other,
 '7e400000-0000-4000-8000-000000000101'::uuid subject,
 '7e400000-0000-4000-8000-000000000102'::uuid person,
 '7e400000-0000-4000-8000-000000000103'::uuid relationship,
 (select id from public.subject_principals where account_id='7e400000-0000-4000-8000-000000000001'
   and principal_kind='account_subject' and status='active') uploader_principal,
 (select id from public.subject_principals where account_id='7e400000-0000-4000-8000-000000000002'
   and principal_kind='account_subject' and status='active') other_principal,
 pg_temp.synthetic_rights_token('7e400000-0000-4000-8000-000000000001','adult-subject-control','revoke-rights-test') token;
select is((select count(*) from fx where token is not null and uploader_principal is not null), 1::bigint,
 'fixture: the accounts have principals and a token hash exists for sessions to reference');

-- A Path B subject the person confirmed with no account: uploader-owned, no
-- subject account, an active non-account principal at revision 2.
insert into public.subjects(id, subject_class, upload_class, display_label, owner_account_id, subject_account_id)
select subject, 'other_adult', 'adult', 'Synthetic person', uploader, null from fx;
insert into public.adult_subject_drafts(owner_account_id, subject_id, draft_revision, state, fixed_expires_at,
 adult_flow, confirmation_mode, evidence_kind, request_key)
select uploader, subject, 1, 'confirmed', clock_timestamp() + interval '20 days', 'path-b-subject-esignature',
 'path-b-token-or-account', 'esignature', encode(extensions.digest('revoke-rights-request','sha256'),'hex') from fx;
insert into public.subject_principals(id, subject_id, account_id, principal_kind, status, principal_revision)
select person, subject, null, 'non_account_subject', 'active', 2 from fx;
insert into public.subject_relationships(id, subject_id, data_subject_principal_id, recipient_principal_id,
 recipient_account_id, relationship_kind, relationship_revision, status)
select relationship, subject, person, uploader_principal, uploader, 'uploader', 1, 'current' from fx;

-- One current grant pair per purpose, to the uploader over that relationship.
create function pg_temp.grant(p_id uuid, p_purpose text, p_recipient_principal uuid default null,
 p_recipient uuid default null, p_binding bigint default 1, p_relationship uuid default null) returns uuid language sql volatile as $$
 insert into public.consent_signatures(id, artifact_key, artifact_version, artifact_body_sha256, signer_principal_id,
  signer_account_id, target_kind, target_id, purpose, statement_keys, jurisdiction_code, jurisdiction_revision, subject_binding_revision)
 select p_id, a.artifact_key, a.version, a.body_sha256, f.person, null, 'subject', f.subject, p_purpose,
  array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time'], 'GB', 1, p_binding
 from public.consent_artifacts a cross join fx f where a.artifact_key='consent.share-with-adult' and a.version=1;
 insert into public.purpose_grants(grant_id, grant_revision, target_kind, target_id, purpose, artifact_key, artifact_version,
  artifact_body_sha256, signature_id, signer_principal_id, data_subject_principal_id, subject_binding_revision,
  jurisdiction_code, jurisdiction_revision)
 select p_id, 1, 'subject', s.target_id, p_purpose, s.artifact_key, s.artifact_version, s.artifact_body_sha256, s.id,
  s.signer_principal_id, s.signer_principal_id, p_binding, 'GB', 1 from public.consent_signatures s where s.id=p_id;
 insert into public.directional_grants(grant_id, grant_revision, recipient_principal_id, recipient_account_id,
  relationship_id, relationship_or_pair_revision, direction)
 select p_id, 1, coalesce(p_recipient_principal, f.uploader_principal), coalesce(p_recipient, f.uploader),
  coalesce(p_relationship, f.relationship), 1, 'subject_to_recipient' from fx f;
 select p_id;
$$;
-- A stale pair first, signed at subject binding revision 1; then the binding
-- moves to 2 and the current pairs are signed there.
select pg_temp.grant('7e400000-0000-4000-8000-000000000203', 'reports.polygenic', null, null, 1);
update public.subjects set subject_binding_revision=2 where id=(select subject from fx);
select pg_temp.grant('7e400000-0000-4000-8000-000000000201', 'ancestry', null, null, 2);
select pg_temp.grant('7e400000-0000-4000-8000-000000000202', 'reports.monogenic', null, null, 2);
-- A pair to someone who is not the uploader is never this door's, even over
-- a relationship row of the same kind.
insert into public.subject_relationships(id, subject_id, data_subject_principal_id, recipient_principal_id,
 recipient_account_id, relationship_kind, relationship_revision, status)
select '7e400000-0000-4000-8000-000000000104', subject, person, other_principal, other, 'uploader', 1, 'current' from fx;
select pg_temp.grant('7e400000-0000-4000-8000-000000000204', 'copilot.local', other_principal, other, 2,
 '7e400000-0000-4000-8000-000000000104') from fx;

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('revoke-rights-test:'||p,'sha256'),'hex') $$;
create function pg_temp.session(p_id uuid, p_secret text, p_revision bigint default 2,
 p_expires timestamptz default clock_timestamp() + interval '1 hour', p_principal uuid default null)
returns uuid language sql volatile as $$
 insert into public.rights_sessions(id, token_hash_id, principal_id, purpose, target_kind, target_id, authority_revision,
  session_hash, expires_at)
 select p_id, token, coalesce(p_principal, person), 'adult-subject-control', 'subject', subject, p_revision,
  pg_temp.h(p_secret), p_expires from fx returning id $$;
create function pg_temp.revoke(p_secret text, p_nonce text, p_purpose text, p_flag boolean default true) returns text
language sql volatile as $$ select public.revoke_purpose_rights_v1(pg_temp.h(p_secret), p_nonce, p_purpose, p_flag) $$;
create function pg_temp.current(p_id text) returns boolean language sql as $$
 select pg.revoked_at is null and dg.status='current' from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id where pg.grant_id=p_id::uuid $$;

-- Privileges -------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.revoke_purpose_rights_v1(text,text,text,boolean)', 'execute'), false,
 'an authenticated client cannot revoke directly');
select is(has_function_privilege('anon', 'public.revoke_purpose_rights_v1(text,text,text,boolean)', 'execute'), false,
 'anon cannot revoke');
select is(has_function_privilege('service_role', 'public.revoke_purpose_rights_v1(text,text,text,boolean)', 'execute'), true,
 'only the service role reaches the door');
select is(has_function_privilege('service_role', 'private.adult_subject_control_v1(text,text,text,text,boolean)', 'execute'), false,
 'the shared control authority is reachable only through a door');

-- Closed until an issuer exists -----------------------------------------------
select is((select count(*) from private.rights_session_purposes where session_purpose='adult-subject-control'), 0::bigint,
 'no issuer has registered the adult-subject-control purpose');
select is(private.rights_action_permitted_v1('adult-subject-control', 'revoke-purpose', 'api.consent-revoke-rights'), false,
 'the purpose matrix refuses the action while no issuer exists');
select throws_ok($$select pg_temp.session('7e400000-0000-4000-8000-000000000301', 'closed')$$,
 '42501', 'rights purpose unavailable', 'no adult-subject-control session can be created');
select throws_ok($$select pg_temp.revoke('closed', 'nonce-revoke-rights-closed-01', 'ancestry')$$,
 '42501', 'not_found', 'with no session the door refuses');

-- What it does once an issuer exists (registered in this transaction only) -------
insert into private.rights_session_purposes(session_purpose, matrix_purpose, invitation_kind, target_kind)
values ('adult-subject-control', 'adult-subject-control', null, 'subject');
select pg_temp.session('7e400000-0000-4000-8000-000000000302', 'current');
select pg_temp.session('7e400000-0000-4000-8000-000000000303', 'stale-principal', 1);
select pg_temp.session('7e400000-0000-4000-8000-000000000304', 'expired', 2, clock_timestamp() - interval '1 second');

select throws_ok($$select pg_temp.revoke('current', 'nonce-revoke-rights-flag-0001', 'ancestry', false)$$,
 '42501', 'not_found', 'outside the test jurisdiction the door refuses');
select throws_ok($$select pg_temp.revoke('stale-principal', 'nonce-revoke-rights-stale-001', 'ancestry')$$,
 '42501', 'not_found', 'a session bound to an earlier principal revision refuses');
select throws_ok($$select pg_temp.revoke('expired', 'nonce-revoke-rights-expired-1', 'ancestry')$$,
 '42501', 'not_found', 'an expired session refuses');
select throws_ok($$select pg_temp.revoke('current', 'nonce-revoke-rights-family-01', 'family.portrait')$$,
 '42501', 'not_found', 'a purpose outside the four individual ones refuses');
select throws_ok($$select pg_temp.revoke('current', 'nonce-revoke-rights-stalepair', 'reports.polygenic')$$,
 '42501', 'not_found', 'a pair from an earlier subject binding refuses');
select is(pg_temp.current('7e400000-0000-4000-8000-000000000203'), true, 'the stale pair is untouched');
select throws_ok($$select pg_temp.revoke('current', 'nonce-revoke-rights-otherrec1', 'copilot.local')$$,
 '42501', 'not_found', 'a pair whose recipient is not the uploader refuses');
select is(pg_temp.current('7e400000-0000-4000-8000-000000000204'), true, 'the other recipient''s pair is untouched');
-- Nor is a pair over a relationship that ended.
update public.subject_relationships set status='revoked', ended_at=clock_timestamp() where id=(select relationship from fx);
select throws_ok($$select pg_temp.revoke('current', 'nonce-revoke-rights-endedrel', 'reports.monogenic')$$,
 '42501', 'not_found', 'a pair over an ended uploader relationship refuses');
update public.subject_relationships set status='current', ended_at=null where id=(select relationship from fx);
select is((pg_temp.current('7e400000-0000-4000-8000-000000000201') and pg_temp.current('7e400000-0000-4000-8000-000000000202')), true,
 'every refusal left both current pairs current');
select is((select count(*) from public.embryo_operation_nonces where target_kind='rights_session'
  and target_id='7e400000-0000-4000-8000-000000000302'), 0::bigint, 'no refused request spent a nonce');

-- The purpose matrix is rechecked on every request, not only at session creation.
delete from private.rights_purpose_matrix where purpose='adult-subject-control' and action='revoke-purpose';
select throws_ok($$select pg_temp.revoke('current', 'nonce-revoke-rights-matrix-01', 'ancestry')$$,
 '42501', 'not_found', 'a session whose action left the matrix refuses');
insert into private.rights_purpose_matrix(purpose, invitation_kind, action, route_id)
values ('adult-subject-control', null, 'revoke-purpose', 'api.consent-revoke-rights');
select is(pg_temp.revoke('current', 'nonce-revoke-rights-first-001', 'ancestry'), 'accepted', 'the ancestry pair is revoked');
select is(pg_temp.current('7e400000-0000-4000-8000-000000000201'), false, 'its base and direction rows ended');
select is((select revocation_reason from public.purpose_grants where grant_id='7e400000-0000-4000-8000-000000000201'), 'withdrawn',
 'the base row is withdrawn');
select is(pg_temp.current('7e400000-0000-4000-8000-000000000202'), true, 'the other purpose stays current');
select is((select count(*) from public.worker_jobs where kind='revoke_purge' and user_id=(select uploader from fx)
  and payload->>'grant_id'='7e400000-0000-4000-8000-000000000201' and payload->>'disposition'='purpose-revocation'
  and payload->>'retention_id'='purpose.derived-60s'), 1::bigint, 'the purpose.derived-60s purge is queued for the uploader''s rows');
select is((select count(*) from public.legal_audit_log where event_code='purpose.revoked' and route_id='api.consent-revoke-rights'
  and coded_context->>'purpose'='ancestry'), 1::bigint, 'the revocation is audited');
select is((select state from public.adult_subject_drafts where subject_id=(select subject from fx)), 'confirmed',
 'the person''s confirmation is preserved');
select is((select status from public.subject_principals where id=(select person from fx)), 'active',
 'the person''s principal stays active');
select throws_ok($$select pg_temp.revoke('current', 'nonce-revoke-rights-first-001', 'reports.monogenic')$$,
 '23505', 'operation nonce already used', 'a nonce cannot be spent twice');
select throws_ok($$select pg_temp.revoke('current', 'nonce-revoke-rights-again-001', 'ancestry')$$,
 '42501', 'not_found', 'an already revoked pair refuses');
select is(pg_temp.revoke('current', 'nonce-revoke-rights-second-01', 'reports.monogenic'), 'accepted',
 'the session revokes another purpose with a fresh nonce');

select * from finish();
rollback;
