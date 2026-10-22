-- api.consent-grant-rights (migration 20261016203000_consent_grant_rights, over
-- 20261016202000_consent_revoke_rights).
-- Synthetic accounts and invented rows only. Everything rolls back.
--
-- The adult-subject-control purpose has no issuer, so no session of it can
-- exist on a real database. The first block proves that. The second block
-- registers the purpose inside this transaction only, to prove what the door
-- does once an issuer exists. Its mitigation gate is real in the second block
-- and replaced, inside this transaction only, by an allow in the third.
begin;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
 ('7f500000-0000-4000-8000-000000000001', 'grant-rights-uploader@example.invalid', '{}'),
 ('7f500000-0000-4000-8000-000000000002', 'grant-rights-other@example.invalid', '{}');

\ir fixtures/synthetic_rights_token.inc
create temporary table fx as select
 '7f500000-0000-4000-8000-000000000001'::uuid uploader,
 '7f500000-0000-4000-8000-000000000002'::uuid other,
 '7f500000-0000-4000-8000-000000000101'::uuid subject,
 '7f500000-0000-4000-8000-000000000102'::uuid person,
 '7f500000-0000-4000-8000-000000000103'::uuid relationship,
 (select id from public.subject_principals where account_id='7f500000-0000-4000-8000-000000000001'
   and principal_kind='account_subject' and status='active') uploader_principal,
 (select id from public.subject_principals where account_id='7f500000-0000-4000-8000-000000000002'
   and principal_kind='account_subject' and status='active') other_principal,
 pg_temp.synthetic_rights_token('7f500000-0000-4000-8000-000000000001','adult-subject-control','grant-rights-test') token;
select is((select count(*) from fx where token is not null and uploader_principal is not null), 1::bigint,
 'fixture: the accounts have principals and a token hash exists for sessions to reference');

-- A Path B subject the person confirmed with no account: uploader-owned, no
-- subject account, an active non-account principal at revision 2.
insert into public.subjects(id, subject_class, upload_class, display_label, owner_account_id, subject_account_id)
select subject, 'other_adult', 'adult', 'Synthetic person', uploader, null from fx;
insert into public.adult_subject_drafts(owner_account_id, subject_id, draft_revision, state, fixed_expires_at,
 adult_flow, confirmation_mode, evidence_kind, request_key)
select uploader, subject, 1, 'confirmed', clock_timestamp() + interval '20 days', 'path-b-subject-esignature',
 'path-b-token-or-account', 'esignature', encode(extensions.digest('grant-rights-request','sha256'),'hex') from fx;
insert into public.subject_principals(id, subject_id, account_id, principal_kind, status, principal_revision)
select person, subject, null, 'non_account_subject', 'active', 2 from fx;


create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('grant-rights-test:'||p,'sha256'),'hex') $$;
create function pg_temp.session(p_id uuid, p_secret text, p_revision bigint default 2) returns uuid language sql volatile as $$
 insert into public.rights_sessions(id, token_hash_id, principal_id, purpose, target_kind, target_id, authority_revision,
  session_hash, expires_at)
 select p_id, token, person, 'adult-subject-control', 'subject', subject, p_revision, pg_temp.h(p_secret),
  clock_timestamp() + interval '1 hour' from fx returning id $$;
create function pg_temp.presentation(p_purpose text, p_nonce text, p_overrides jsonb default '{}'::jsonb) returns jsonb
language sql as $$
 select jsonb_build_object('principalId', f.person, 'uploaderPrincipalId', f.uploader_principal,
  'uploaderAccountId', f.uploader, 'subjectBindingRevision', s.subject_binding_revision,
  'relationshipId', r.id, 'relationshipRevision', r.relationship_revision, 'purpose', p_purpose,
  'artifactVersion', a.version, 'artifactBodySha256', a.body_sha256, 'nonce', p_nonce) || p_overrides
 from fx f join public.subjects s on s.id=f.subject
 cross join public.consent_artifacts a
 left join public.subject_relationships r on r.subject_id=f.subject and r.data_subject_principal_id=f.person
  and r.relationship_kind='uploader' and r.status='current'
 where a.artifact_key='consent.share-with-adult' and a.superseded_at is null $$;
create function pg_temp.grant(p_secret text, p_nonce text, p_presentation jsonb,
 p_keys text[] default array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time'],
 p_name bytea default decode(repeat('ab',24),'hex'), p_code text default 'GB', p_flag boolean default true)
returns jsonb language sql volatile as $$
 select public.grant_purpose_rights_v1(pg_temp.h(p_secret), p_nonce, p_presentation, p_keys, p_name, p_code, p_flag) $$;
create function pg_temp.current_pairs(p_purpose text) returns bigint language sql as $$
 select count(*) from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id
 where pg.target_id=(select subject from fx) and pg.purpose=p_purpose and pg.revoked_at is null and dg.status='current' $$;

-- Privileges -------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.grant_purpose_rights_v1(text,text,jsonb,text[],bytea,text,boolean)', 'execute'), false,
 'an authenticated client cannot grant directly');
select is(has_function_privilege('anon', 'public.grant_purpose_rights_v1(text,text,jsonb,text[],bytea,text,boolean)', 'execute'), false,
 'anon cannot grant');
select is(has_function_privilege('service_role', 'public.grant_purpose_rights_v1(text,text,jsonb,text[],bytea,text,boolean)', 'execute'), true,
 'only the service role reaches the door');

-- Closed until an issuer exists -----------------------------------------------
select is(private.rights_action_permitted_v1('adult-subject-control', 'grant-purpose', 'api.consent-grant-rights'), false,
 'the purpose matrix refuses the action while no issuer exists');
select throws_ok($$select pg_temp.session('7f500000-0000-4000-8000-000000000301', 'closed')$$,
 '42501', 'rights purpose unavailable', 'no adult-subject-control session can be created');
select throws_ok($$select pg_temp.grant('closed', 'nonce-grant-rights-closed-001', pg_temp.presentation('ancestry', 'present-grant-closed-00001'))$$,
 '42501', 'not_found', 'with no session the door refuses');

-- An issuer exists (registered in this transaction only); the mitigation is real --
insert into private.rights_session_purposes(session_purpose, matrix_purpose, invitation_kind, target_kind)
values ('adult-subject-control', 'adult-subject-control', null, 'subject');
select pg_temp.session('7f500000-0000-4000-8000-000000000302', 'current');
select is((private.other_adult_mitigation_v1((select subject from fx), (select uploader from fx), 'purpose-grant-create'))->>'decision',
 'deny', 'fixture: the unchanged mitigation denies the uploader of a no-account subject');
select throws_ok($$select pg_temp.grant('current', 'nonce-grant-rights-mitig-001', pg_temp.presentation('ancestry', 'present-grant-mitig-000001'))$$,
 '42501', 'not_found', 'while the mitigation denies, no grant is made');
select is(pg_temp.current_pairs('ancestry'), 0::bigint, 'the refused grant wrote nothing');
select is((select count(*) from public.subject_relationships where subject_id=(select subject from fx)), 0::bigint,
 'the refused grant created no relationship');

-- The mitigation allows (replaced inside this transaction only) ------------------
create or replace function private.other_adult_mitigation_v1(p_subject_id uuid, p_account_id uuid, p_checkpoint text)
returns jsonb language sql stable as $$ select '{"decision":"allow","gate":null}'::jsonb $$;

select throws_ok($$select pg_temp.grant('current', 'nonce-grant-rights-flag-0001', pg_temp.presentation('ancestry', 'present-grant-flag-0000001'),
  p_flag => false)$$, '42501', 'not_found', 'outside the test jurisdiction the door refuses');
select throws_ok($$select pg_temp.grant('current', 'nonce-grant-rights-copil-001', pg_temp.presentation('copilot.local', 'present-grant-copil-000001'))$$,
 '42501', 'not_found', 'copilot.local has no Path B scope and is refused');
select throws_ok($$select pg_temp.grant('current', 'nonce-grant-rights-famly-001', pg_temp.presentation('family.portrait', 'present-grant-famly-000001'))$$,
 '42501', 'not_found', 'a family purpose is refused');
select throws_ok($$select pg_temp.grant('current', 'nonce-grant-rights-princ-001', pg_temp.presentation('ancestry', 'present-grant-princ-000001',
  jsonb_build_object('principalId', (select uploader_principal from fx))))$$, '42501', 'not_found', 'a presentation for another signer is refused');
select throws_ok($$select pg_temp.grant('current', 'nonce-grant-rights-recip-001', pg_temp.presentation('ancestry', 'present-grant-recip-000001',
  jsonb_build_object('uploaderAccountId', (select other from fx), 'uploaderPrincipalId', (select other_principal from fx))))$$,
 '42501', 'not_found', 'a presentation that retargets the recipient is refused');
select throws_ok($$select pg_temp.grant('current', 'nonce-grant-rights-bind-0001', pg_temp.presentation('ancestry', 'present-grant-bind-0000001',
  '{"subjectBindingRevision": 7}'::jsonb))$$, '42501', 'not_found', 'a presentation for another subject binding is refused');
select throws_ok($$select pg_temp.grant('current', 'nonce-grant-rights-extra-001', pg_temp.presentation('ancestry', 'present-grant-extra-000001',
  '{"grants": []}'::jsonb))$$, '42501', 'not_found', 'a presentation with an extra field is refused');
select throws_ok($$select pg_temp.grant('current', 'nonce-grant-rights-artif-001', pg_temp.presentation('ancestry', 'present-grant-artif-000001',
  jsonb_build_object('artifactBodySha256', repeat('0', 64))))$$, '42501', 'not_found', 'a presentation of another text is refused');
select throws_ok($$select pg_temp.grant('current', 'nonce-grant-rights-stmts-001', pg_temp.presentation('ancestry', 'present-grant-stmts-000001'),
  array['one-purpose'])$$, '42501', 'not_found', 'a statement set that is not the published one is refused');
select throws_ok($$select pg_temp.grant('current', 'nonce-grant-rights-name-0001', pg_temp.presentation('ancestry', 'present-grant-name-0000001'),
  p_name => null)$$, '42501', 'not_found', 'a grant without the typed name is refused');
select throws_ok($$select pg_temp.grant('current', 'nonce-grant-rights-code-0001', pg_temp.presentation('ancestry', 'present-grant-code-0000001'),
  p_code => 'gb')$$, '42501', 'not_found', 'a malformed country code is refused');
select is(pg_temp.current_pairs('ancestry'), 0::bigint, 'every refusal wrote nothing');

create temporary table first_grant as
 select pg_temp.grant('current', 'nonce-grant-rights-first-001', pg_temp.presentation('ancestry', 'present-grant-first-000001')) body;
select is((select array_agg(k order by k) from first_grant, jsonb_object_keys(body) k),
 array['artifactKey','artifactVersion','purposeKey','recordId','recordKind','signedAt'], 'the receipt has consent-recorded-v1''s keys');
select is((select body->>'recordKind'||'|'||(body->>'artifactKey')||'|'||(body->>'purposeKey') from first_grant),
 'purpose_grant|consent.share-with-adult|ancestry', 'the receipt names the grant, its text and its purpose');
select is(pg_temp.current_pairs('ancestry'), 1::bigint, 'one current pair exists');
select is((select dg.direction||'|'||dg.recipient_account_id::text||'|'||r.relationship_kind
  from public.directional_grants dg join public.subject_relationships r on r.id=dg.relationship_id
  where dg.grant_id=(select (body->>'recordId')::uuid from first_grant)),
 'subject_to_recipient|'||(select uploader from fx)::text||'|uploader', 'the pair points at the uploader over an uploader relationship');
select is((select signer_principal_id=(select person from fx) and signer_account_id is null and signing_name_encrypted is not null
  and statement_keys=array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time'] and jurisdiction_code='GB'
  from public.consent_signatures where id=(select signature_id from public.purpose_grants where grant_id=(select (body->>'recordId')::uuid from first_grant))),
 true, 'the person signs with no account, the four statements, a ciphertext name and their own country');
select is((select count(*) from public.legal_audit_log where event_code='purpose.granted' and route_id='api.consent-grant-rights'),
 1::bigint, 'the grant is audited');
select throws_ok($$select pg_temp.grant('current', 'nonce-grant-rights-reuse-001', pg_temp.presentation('ancestry', 'present-grant-stale-000001',
  '{"relationshipId": null, "relationshipRevision": null}'::jsonb))$$,
 '42501', 'not_found', 'a presentation minted before the relationship existed is stale now');
select throws_ok($$select pg_temp.grant('current', 'nonce-grant-rights-reuse-002', pg_temp.presentation('ancestry', 'present-grant-first-000001'))$$,
 '23505', 'operation nonce already used', 'a presentation grants at most once');
select throws_ok($$select pg_temp.grant('current', 'nonce-grant-rights-first-001', pg_temp.presentation('ancestry', 'present-grant-fresh-000001'))$$,
 '23505', 'operation nonce already used', 'an operation nonce is spent once');

create temporary table second_grant as
 select pg_temp.grant('current', 'nonce-grant-rights-second01', pg_temp.presentation('ancestry', 'present-grant-second-00001')) body;
select is(pg_temp.current_pairs('ancestry'), 1::bigint, 'a fresh grant of the same purpose leaves exactly one current pair');
select is((select revocation_reason from public.purpose_grants where grant_id=(select (body->>'recordId')::uuid from first_grant)),
 'superseded', 'the earlier pair is superseded, not withdrawn');
select is((select count(*) from public.subject_relationships where subject_id=(select subject from fx) and status='current'), 1::bigint,
 'the uploader relationship is reused');

select is(public.revoke_purpose_rights_v1(pg_temp.h('current'), 'nonce-grant-rights-revoke1', 'ancestry', true), 'accepted',
 'the same session can turn the purpose off again');
select is(pg_temp.current_pairs('ancestry'), 0::bigint, 'after revoking no pair is current');

select * from finish();
rollback;
