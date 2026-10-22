-- api.consent-reaffirm-rights (migration 20261016206000_consent_reaffirm_rights).
-- Synthetic accounts and invented rows only. Everything rolls back.
--
-- The consent-reaffirm session purpose has no issuer (its notice wording is
-- not approved), so no session of it can exist on a real database. The first
-- block proves that. The second registers the purpose inside this
-- transaction only, to prove what the door does once an issuer exists: with
-- the real mitigation first, then with it replaced by an allow.
begin;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
 ('7f600000-0000-4000-8000-000000000001', 'reaffirm-rights-uploader@example.invalid', '{}'),
 ('7f600000-0000-4000-8000-000000000002', 'reaffirm-rights-other@example.invalid', '{}');

\ir fixtures/synthetic_rights_token.inc
create temporary table fx as select
 '7f600000-0000-4000-8000-000000000001'::uuid uploader,
 '7f600000-0000-4000-8000-000000000002'::uuid other,
 '7f600000-0000-4000-8000-000000000101'::uuid subject,
 '7f600000-0000-4000-8000-000000000102'::uuid person,
 '7f600000-0000-4000-8000-000000000103'::uuid relationship,
 '7f600000-0000-4000-8000-000000000104'::uuid prior_grant,
 (select id from public.subject_principals where account_id='7f600000-0000-4000-8000-000000000001'
   and principal_kind='account_subject' and status='active') uploader_principal,
 (select id from public.subject_principals where account_id='7f600000-0000-4000-8000-000000000002'
   and principal_kind='account_subject' and status='active') other_principal,
 pg_temp.synthetic_rights_token('7f600000-0000-4000-8000-000000000001','consent-reaffirm','reaffirm-rights-test') token,
 (select version from public.consent_artifacts where artifact_key='consent.share-with-adult' and superseded_at is null) old_version;
select is((select count(*) from fx where token is not null and uploader_principal is not null), 1::bigint,
 'fixture: the accounts have principals and a token hash exists for sessions to reference');

-- A Path B subject the person confirmed with no account, and one uploader-
-- direction grant they signed with a typed name under the current text.
insert into public.subjects(id, subject_class, upload_class, display_label, owner_account_id, subject_account_id)
select subject, 'other_adult', 'adult', 'Synthetic person', uploader, null from fx;
insert into public.adult_subject_drafts(owner_account_id, subject_id, draft_revision, state, fixed_expires_at,
 adult_flow, confirmation_mode, evidence_kind, request_key)
select uploader, subject, 1, 'confirmed', clock_timestamp() + interval '20 days', 'path-b-subject-esignature',
 'path-b-token-or-account', 'esignature', encode(extensions.digest('reaffirm-rights-request','sha256'),'hex') from fx;
insert into public.subject_principals(id, subject_id, account_id, principal_kind, status, principal_revision)
select person, subject, null, 'non_account_subject', 'active', 2 from fx;
insert into public.subject_relationships(id, subject_id, data_subject_principal_id, recipient_principal_id,
 recipient_account_id, relationship_kind, relationship_revision, status)
select relationship, subject, person, uploader_principal, uploader, 'uploader', 1, 'current' from fx;
with sig as (
 insert into public.consent_signatures(artifact_key, artifact_version, artifact_body_sha256, signer_principal_id,
  signer_account_id, target_kind, target_id, purpose, statement_keys, signing_name_encrypted, jurisdiction_code,
  jurisdiction_revision, subject_binding_revision)
 select a.artifact_key, a.version, a.body_sha256, f.person, null, 'subject', f.subject, 'ancestry',
  array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time'], decode(repeat('ab',24),'hex'), 'GB', 1,
  s.subject_binding_revision
 from fx f join public.subjects s on s.id=f.subject cross join public.consent_artifacts a
 where a.artifact_key='consent.share-with-adult' and a.superseded_at is null returning id, artifact_key, artifact_version,
  artifact_body_sha256, subject_binding_revision)
insert into public.purpose_grants(grant_id, grant_revision, target_kind, target_id, purpose, artifact_key, artifact_version,
 artifact_body_sha256, signature_id, signer_principal_id, data_subject_principal_id, subject_binding_revision,
 jurisdiction_code, jurisdiction_revision)
select f.prior_grant, 1, 'subject', f.subject, 'ancestry', sig.artifact_key, sig.artifact_version, sig.artifact_body_sha256,
 sig.id, f.person, f.person, sig.subject_binding_revision, 'GB', 1 from fx f, sig;
insert into public.directional_grants(grant_id, grant_revision, recipient_principal_id, recipient_account_id, relationship_id,
 relationship_or_pair_revision, direction)
select prior_grant, 1, uploader_principal, uploader, relationship, 1, 'subject_to_recipient' from fx;

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('reaffirm-rights-test:'||p,'sha256'),'hex') $$;
create function pg_temp.session(p_id uuid, p_secret text, p_revision bigint default 1) returns uuid language sql volatile as $$
 insert into public.rights_sessions(id, token_hash_id, principal_id, purpose, target_kind, target_id, authority_revision,
  session_hash, expires_at)
 select p_id, token, person, 'consent-reaffirm', 'purpose_grant', prior_grant, p_revision, pg_temp.h(p_secret),
  clock_timestamp() + interval '1 hour' from fx returning id $$;
create function pg_temp.presentation(p_nonce text, p_overrides jsonb default '{}'::jsonb) returns jsonb language sql as $$
 select jsonb_build_object('priorGrantId', f.prior_grant, 'priorRevision', 1, 'principalId', f.person,
  'uploaderPrincipalId', f.uploader_principal, 'uploaderAccountId', f.uploader, 'relationshipId', f.relationship,
  'relationshipRevision', 1, 'subjectBindingRevision', s.subject_binding_revision, 'purpose', 'ancestry',
  'artifactVersion', a.version, 'artifactBodySha256', a.body_sha256, 'nonce', p_nonce) || p_overrides
 from fx f join public.subjects s on s.id=f.subject cross join public.consent_artifacts a
 where a.artifact_key='consent.share-with-adult' and a.superseded_at is null $$;
create function pg_temp.reaffirm(p_secret text, p_nonce text, p_presentation jsonb,
 p_keys text[] default array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time'],
 p_name bytea default decode(repeat('cd',24),'hex'), p_code text default 'GB', p_flag boolean default true)
returns jsonb language sql volatile as $$
 select public.reaffirm_purpose_rights_v1(pg_temp.h(p_secret), p_nonce, p_presentation, p_keys, p_name, p_code, p_flag) $$;
create function pg_temp.current_pairs() returns bigint language sql as $$
 select count(*) from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id
 where pg.target_id=(select subject from fx) and pg.purpose='ancestry' and pg.revoked_at is null and dg.status='current' $$;
create function pg_temp.prior_current() returns boolean language sql as $$
 select pg.revoked_at is null and dg.status='current' from public.purpose_grants pg join public.directional_grants dg
 on dg.grant_id=pg.grant_id where pg.grant_id=(select prior_grant from fx) $$;

-- Privileges -------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.reaffirm_purpose_rights_v1(text,text,jsonb,text[],bytea,text,boolean)', 'execute'), false,
 'an authenticated client cannot reaffirm directly');
select is(has_function_privilege('anon', 'public.reaffirm_purpose_rights_v1(text,text,jsonb,text[],bytea,text,boolean)', 'execute'), false,
 'anon cannot reaffirm');
select is(has_function_privilege('service_role', 'public.reaffirm_purpose_rights_v1(text,text,jsonb,text[],bytea,text,boolean)', 'execute'), true,
 'only the service role reaches the door');

-- Closed until an issuer exists ---------------------------------------------------
select is((select count(*) from private.rights_session_purposes where session_purpose='consent-reaffirm'), 0::bigint,
 'no issuer registers the consent-reaffirm session purpose');
select is(private.rights_action_permitted_v1('consent-reaffirm', 'reaffirm', 'api.consent-reaffirm-rights'), false,
 'the purpose matrix refuses the action while no issuer exists');
select throws_ok($$select pg_temp.session('7f600000-0000-4000-8000-000000000301', 'closed')$$,
 '42501', 'rights purpose unavailable', 'no consent-reaffirm session can be created');
select throws_ok($$select pg_temp.reaffirm('closed', 'nonce-reaffirm-rights-closed1', pg_temp.presentation('present-reaffirm-closed-001'))$$,
 '42501', 'not_found', 'with no session the door refuses');

-- An issuer exists (registered in this transaction only) ---------------------------
insert into private.rights_session_purposes(session_purpose, matrix_purpose, invitation_kind, target_kind)
values ('consent-reaffirm', 'consent-reaffirm', null, 'purpose_grant');
select pg_temp.session('7f600000-0000-4000-8000-000000000302', 'current');
select throws_ok($$select pg_temp.reaffirm('current', 'nonce-reaffirm-rights-text01', pg_temp.presentation('present-reaffirm-text-0001'))$$,
 '42501', 'not_found', 'while the signed text is still current nothing is offered');
select private.publish_consent_artifact_v1('consent.share-with-adult', (select old_version from fx),
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=(select old_version from fx)),
 (select old_version + 1 from fx), 'Synthetic next share text.', 'Synthetic summary.', current_date, 'Synthetic changed body.');
select is((private.other_adult_mitigation_v1((select subject from fx), (select uploader from fx), 'purpose-grant-create'))->>'decision',
 'deny', 'fixture: with no live 730-day clock the real mitigation denies the uploader');
select throws_ok($$select pg_temp.reaffirm('current', 'nonce-reaffirm-rights-mitig1', pg_temp.presentation('present-reaffirm-mitig-001'))$$,
 '42501', 'not_found', 'while the mitigation denies, nothing is reaffirmed');
select ok(pg_temp.prior_current(), 'the refusal left the prior pair current');

create or replace function private.other_adult_mitigation_v1(p_subject_id uuid, p_account_id uuid, p_checkpoint text)
returns jsonb language sql stable as $$ select '{"decision":"allow","gate":null}'::jsonb $$;

select throws_ok($$select pg_temp.reaffirm('current', 'nonce-reaffirm-rights-flag01', pg_temp.presentation('present-reaffirm-flag-0001'),
  p_flag => false)$$, '42501', 'not_found', 'outside the test jurisdiction the door refuses');
select throws_ok($$select pg_temp.reaffirm('current', 'nonce-reaffirm-rights-purp01', pg_temp.presentation('present-reaffirm-purp-0001',
  '{"purpose":"reports.monogenic"}'::jsonb))$$, '42501', 'not_found', 'a presentation of another purpose is refused');
select throws_ok($$select pg_temp.reaffirm('current', 'nonce-reaffirm-rights-recp01', pg_temp.presentation('present-reaffirm-recp-0001',
  jsonb_build_object('uploaderAccountId', (select other from fx), 'uploaderPrincipalId', (select other_principal from fx))))$$,
 '42501', 'not_found', 'a presentation that retargets the recipient is refused');
select throws_ok($$select pg_temp.reaffirm('current', 'nonce-reaffirm-rights-revn01', pg_temp.presentation('present-reaffirm-revn-0001',
  '{"priorRevision":2}'::jsonb))$$, '42501', 'not_found', 'a presentation of another prior revision is refused');
select throws_ok($$select pg_temp.reaffirm('current', 'nonce-reaffirm-rights-text02', pg_temp.presentation('present-reaffirm-text-0002',
  jsonb_build_object('artifactVersion', (select old_version from fx),
   'artifactBodySha256', (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult'
    and version=(select old_version from fx)))))$$, '42501', 'not_found', 'the superseded text cannot be signed again');
select throws_ok($$select pg_temp.reaffirm('current', 'nonce-reaffirm-rights-extr01', pg_temp.presentation('present-reaffirm-extr-0001',
  '{"grants":[]}'::jsonb))$$, '42501', 'not_found', 'a presentation with an extra field is refused');
select throws_ok($$select pg_temp.reaffirm('current', 'nonce-reaffirm-rights-stmt01', pg_temp.presentation('present-reaffirm-stmt-0001'),
  array['one-purpose'])$$, '42501', 'not_found', 'a statement set that is not the published one is refused');
select throws_ok($$select pg_temp.reaffirm('current', 'nonce-reaffirm-rights-name01', pg_temp.presentation('present-reaffirm-name-0001'),
  p_name => null)$$, '42501', 'not_found', 'a reaffirmation without the typed name is refused');
select throws_ok($$select pg_temp.reaffirm('current', 'nonce-reaffirm-rights-code01', pg_temp.presentation('present-reaffirm-code-0001'),
  p_code => 'gb')$$, '42501', 'not_found', 'a malformed country code is refused');
select pg_temp.session('7f600000-0000-4000-8000-000000000303', 'stale', 2);
select throws_ok($$select pg_temp.reaffirm('stale', 'nonce-reaffirm-rights-stal01', pg_temp.presentation('present-reaffirm-stal-0001'))$$,
 '42501', 'not_found', 'a session bound to another revision of the grant is refused');
delete from private.rights_purpose_matrix where purpose='consent-reaffirm' and action='reaffirm';
select throws_ok($$select pg_temp.reaffirm('current', 'nonce-reaffirm-rights-matx01', pg_temp.presentation('present-reaffirm-matx-0001'))$$,
 '42501', 'not_found', 'with the matrix row removed between requests the door refuses');
insert into private.rights_purpose_matrix(purpose, invitation_kind, action, route_id)
values ('consent-reaffirm', null, 'reaffirm', 'api.consent-reaffirm-rights');
select ok(pg_temp.prior_current() and pg_temp.current_pairs()=1, 'every refusal left the prior pair current and wrote nothing');

create temporary table receipt as
 select pg_temp.reaffirm('current', 'nonce-reaffirm-rights-good01', pg_temp.presentation('present-reaffirm-good-0001')) body;
select is((select array_agg(k order by k) from receipt, jsonb_object_keys(body) k),
 array['artifactKey','artifactVersion','purposeKey','recordId','recordKind','signedAt'], 'the receipt has consent-recorded-v1''s keys');
select ok((select (body->>'artifactVersion')::integer=(select old_version+1 from fx) and body->>'purposeKey'='ancestry'
 from receipt), 'the receipt names the current text and the same purpose');
select ok((select pg.grant_revision=2 and dg.grant_revision=2 and dg.status='current' and pg.revoked_at is null
  and dg.relationship_id=(select relationship from fx) and dg.relationship_or_pair_revision=1
  and dg.recipient_account_id=(select uploader from fx) and pg.signer_principal_id=(select person from fx)
 from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id
 where pg.grant_id=(select (body->>'recordId')::uuid from receipt)),
 'the new pair carries one identical grant revision, the prior plus one, over the same uploader relationship');
select ok((select pg.revocation_reason='superseded' and dg.status='superseded' from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id where pg.grant_id=(select prior_grant from fx)),
 'the prior pair is superseded in the same transaction');
select is(pg_temp.current_pairs(), 1::bigint, 'exactly one pair is current');
select ok((select cs.signer_account_id is null and cs.signing_name_encrypted=decode(repeat('cd',24),'hex')
  and cs.jurisdiction_code='GB' and cs.artifact_version=(select old_version+1 from fx)
 from public.purpose_grants pg join public.consent_signatures cs on cs.id=pg.signature_id
 where pg.grant_id=(select (body->>'recordId')::uuid from receipt)), 'a fresh no-account signature of the current text');
select is((select status from public.rights_sessions where id='7f600000-0000-4000-8000-000000000302'), 'consumed',
 'the rights session ends with the revision it authorized');
select is((select count(*) from public.legal_audit_log where event_code='purpose.reaffirmed' and route_id='api.consent-reaffirm-rights'),
 1::bigint, 'one reaffirmation audit event');
select throws_ok($$select pg_temp.reaffirm('current', 'nonce-reaffirm-rights-good02', pg_temp.presentation('present-reaffirm-good-0002'))$$,
 '42501', 'not_found', 'the consumed session cannot reaffirm again');

select * from finish();
rollback;
