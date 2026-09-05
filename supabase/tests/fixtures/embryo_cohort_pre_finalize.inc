
-- Three accounts: the owner-parent A, the invited co-parent B, a stranger C.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('7a000000-0000-0000-0000-000000000001', 'embryo-owner@example.invalid',
   '{"display_name":"Owner"}'),
  ('7a000000-0000-0000-0000-000000000002', 'embryo-coparent@example.invalid',
   '{"display_name":"Co-parent"}'),
  ('7a000000-0000-0000-0000-000000000003', 'embryo-stranger@example.invalid',
   '{"display_name":"Stranger"}');

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values
  ('7a000000-0000-4000-8000-0000000000a1', '7a000000-0000-0000-0000-000000000001',
   clock_timestamp(), clock_timestamp(), 'aal1'),
  ('7a000000-0000-4000-8000-0000000000b1', '7a000000-0000-0000-0000-000000000002',
   clock_timestamp(), clock_timestamp(), 'aal1'),
  ('7a000000-0000-4000-8000-0000000000b2', '7a000000-0000-0000-0000-000000000002',
   clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '20 minutes',
   'aal1'),
  ('7a000000-0000-4000-8000-0000000000c1', '7a000000-0000-0000-0000-000000000003',
   clock_timestamp(), clock_timestamp(), 'aal1');

update public.profiles set jurisdiction_code = 'GB'
where id in (
  '7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-0000-0000-000000000002',
  '7a000000-0000-0000-0000-000000000003'
);

-- ---------------------------------------------------------------------------
-- Artifacts
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from public.consent_artifacts
   where version = 1 and artifact_key in (
     'consent.upload-embryo', 'attestation.embryo-parentage',
     'attestation.embryo-disposition-rights', 'attestation.embryo-single-parent-basis',
     'charter.future-person', 'disclosure.insurance-and-discrimination')),
  6::bigint,
  'the six embryo artifacts are seeded at version 1'
);
select ok(
  (select body_markdown from public.consent_artifacts
   where artifact_key = 'consent.upload-embryo' and version = 1)
  like '%No child anywhere has been born and followed up after embryos were compared this way. There is no outcome data. Every number on this page is a simulation.%',
  'the embryo consent carries the governing sentence verbatim'
);
select is(
  (select count(*) from public.consent_artifacts a
   where a.artifact_key in (
     'consent.upload-embryo', 'attestation.embryo-parentage',
     'attestation.embryo-disposition-rights', 'attestation.embryo-single-parent-basis',
     'charter.future-person', 'disclosure.insurance-and-discrimination')
     and a.body_sha256 <> encode(extensions.digest(
       convert_to(a.body_markdown, 'UTF8'), 'sha256'), 'hex')),
  0::bigint,
  'every seeded body hash is the digest of its body'
);

-- ---------------------------------------------------------------------------
-- Draft creation
-- ---------------------------------------------------------------------------
create temporary table draft as
select * from public.create_embryo_cohort_draft_v1(
  '7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',
  'own_embryos', 'true_two_parent', 3,
  decode('00112233445566778899aabbccddeeff', 'hex'), repeat('a', 64),
  array['ffeeddccbbaa99887766554433221100'], array[repeat('b', 64)],
  'nonce-draft-0001-aaaaaaaaaaaa', true
);

select is((select count(*) from draft), 1::bigint,
  'an eligible parent reserves one draft');
select is((select required_principal_slots from draft), array['other-genetic-parent'],
  'a two-parent own-embryo draft names one other genetic parent slot');
select is(
  (select state from public.embryo_cohort_drafts where id = (select draft_id from draft)),
  'draft', 'a two-parent draft starts in draft state');
select is(
  (select array_agg(s.state order by s.slot_kind)
   from public.draft_participant_slots s
   where s.embryo_draft_id = (select draft_id from draft)),
  array['current', 'pending'],
  'parent_a is the uploader and parent_b waits for acceptance');
select is(
  (select count(*) from public.retention_rows
   where retention_id = 'embryo.cohort-draft-30d'
     and target_kind = 'cohort' and target_id = (select draft_id from draft)),
  1::bigint, 'the draft carries its fixed 30-day retention row');
select is(
  (select status from public.retention_due_phases
   where retention_id = 'embryo.cohort-draft-30d'
     and target_id = (select draft_id from draft)),
  'pending', 'the draft-expiry phase is pending');
select throws_ok(
  $$select public.create_embryo_cohort_draft_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      'own_embryos', 'true_two_parent', 3,
      decode('00', 'hex'), repeat('a', 64), '{}'::text[], '{}'::text[],
      'nonce-draft-0002-aaaaaaaaaaaa', true)$$,
  '22023', 'invalid contact cardinality',
  'a two-parent own-embryo draft needs exactly one other contact');
select throws_ok(
  $$select public.create_embryo_cohort_draft_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      'own_embryos', 'true_two_parent', 3,
      decode('00', 'hex'), repeat('a', 64),
      array['ffeeddccbbaa99887766554433221100'], array[repeat('b', 64)],
      'nonce-draft-0001-aaaaaaaaaaaa', true)$$,
  '23505', 'operation nonce already used',
  'a replayed operation nonce fails closed');

-- ---------------------------------------------------------------------------
-- Artifact signatures by the owner
-- ---------------------------------------------------------------------------
create temporary table sig_upload as
select public.sign_embryo_artifact_v1(
  '7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',
  'cohort_draft', (select draft_id from draft),
  'consent.upload-embryo', 1,
  private.embryo_statement_keys_v1('consent.upload-embryo', 'parent'),
  decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0001-aaaaaaaaaaaa'
) as id;

select is((select count(*) from public.consent_signatures
  where id = (select id from sig_upload) and purpose = 'embryo-upload-parent-class'),
  1::bigint, 'the owner-parent signs the upload consent as a parent');
select throws_ok(
  $$select public.sign_embryo_artifact_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      'cohort_draft', (select draft_id from draft),
      'attestation.embryo-parentage', 1, array['something-else'],
      decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0002-aaaaaaaaaaaa')$$,
  '22023', 'statement keys differ from the published set',
  'a signature must carry exactly the published statement keys');
select throws_ok(
  $$select public.sign_embryo_artifact_v1(
      '7a000000-0000-0000-0000-000000000003',
      '7a000000-0000-4000-8000-0000000000c1',
      'cohort_draft', (select draft_id from draft),
      'attestation.embryo-parentage', 1,
      private.embryo_statement_keys_v1('attestation.embryo-parentage'),
      decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0003-aaaaaaaaaaaa')$$,
  '42501', 'not a current parent',
  'a stranger cannot attest parentage on someone else''s draft');
select throws_ok(
  $$select public.sign_embryo_artifact_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      'cohort_draft', (select draft_id from draft),
      'attestation.embryo-parentage', 2,
      private.embryo_statement_keys_v1('attestation.embryo-parentage'),
      decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0004-aaaaaaaaaaaa')$$,
  '55000', 'artifact superseded',
  'only the current artifact version can be signed');
select is(
  public.sign_embryo_artifact_v1(
    '7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',
    'cohort_draft', (select draft_id from draft),
    'consent.upload-embryo', 1,
    private.embryo_statement_keys_v1('consent.upload-embryo', 'parent'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0005-aaaaaaaaaaaa'),
  (select id from sig_upload),
  'signing the same artifact again returns the existing record');
select lives_ok(
  $$select public.sign_embryo_artifact_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      'cohort_draft', (select draft_id from draft),
      'attestation.embryo-parentage', 1,
      private.embryo_statement_keys_v1('attestation.embryo-parentage'),
      decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0006-aaaaaaaaaaaa')$$,
  'the owner-parent attests parentage');
select lives_ok(
  $$select public.sign_embryo_artifact_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      'cohort_draft', (select draft_id from draft),
      'attestation.embryo-disposition-rights', 1,
      private.embryo_statement_keys_v1('attestation.embryo-disposition-rights'),
      decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0007-aaaaaaaaaaaa')$$,
  'the owner-parent attests disposition rights');
select throws_ok(
  $$select public.sign_embryo_artifact_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      'cohort_draft', (select draft_id from draft),
      'attestation.embryo-single-parent-basis', 1,
      private.embryo_statement_keys_v1('attestation.embryo-single-parent-basis'),
      decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0008-aaaaaaaaaaaa')$$,
  '22023', 'basis does not take this artifact',
  'a two-parent draft refuses the single-parent basis artifact');
select is(
  (select count(*) from public.attestations
   where target_kind = 'cohort_draft' and target_id = (select draft_id from draft)
     and kind in ('genetic_parent', 'disposition_rights')),
  2::bigint, 'each attestation writes its typed attestation row');

-- ---------------------------------------------------------------------------
-- Co-parent invitation, activation and acceptance
-- ---------------------------------------------------------------------------
create temporary table inv as
select * from public.create_embryo_draft_invitation_v1(
  '7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1', (select draft_id from draft),
  repeat('b', 64), repeat('1', 64), 'nonce-invite-0001-aaaaaaaaaaa', true
);

select ok((select invitation_id from inv) is not null,
  'the typed co-parent contact receives one invitation');
select is(
  (select count(*) from public.mail_outbox
   where template_id = 'co-parent-invitation'
     and target_id = (select invitation_id from inv)),
  1::bigint, 'one invitation mail is queued');
select ok(
  (select invitation_id from public.create_embryo_draft_invitation_v1(
    '7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1', (select draft_id from draft),
    repeat('e', 64), repeat('2', 64), 'nonce-invite-0002-aaaaaaaaaaa', true)) is null,
  'an address the draft never named gets the same empty receipt and no mail');
select is(
  (select count(*) from public.subject_invitations
   where target_kind = 'cohort_draft' and target_id = (select draft_id from draft)),
  1::bigint, 'the unmatched address wrote no invitation');

create temporary table claimed as select * from public.claim_mail_outbox();

select matches((select delivery_token from claimed), '^[A-Za-z0-9_-]{43}$',
  'the mail worker receives one URL-safe delivery token for the co-parent');

create temporary table tok as
select encode(extensions.digest(
  convert_to((select delivery_token from claimed), 'UTF8'), 'sha256'
), 'hex') as token_hash;

create temporary table rs as
select * from public.activate_rights_session_v1(
  (select token_hash from tok), repeat('c', 64), 'form-nonce-0001-aaaaaaaaaaaa'
);

select is((select purpose from rs), 'co-parent-invitation',
  'the token activates one co-parent rights session');
select throws_ok(
  $$select * from public.activate_rights_session_v1(
      (select token_hash from tok), repeat('d', 64), 'form-nonce-0001-aaaaaaaaaaaa')$$,
  '23505', 'operation nonce already used',
  'a replayed activation form fails closed before any read');
select is(
  (select count(*) from public.activate_rights_session_v1(
    (select token_hash from tok), repeat('d', 64), 'form-nonce-0002-aaaaaaaaaaaa')),
  0::bigint, 'a consumed token activates nothing');
select throws_ok(
  $$select public.accept_embryo_co_parent_invitation_v1(
      repeat('c', 64), '7a000000-0000-0000-0000-000000000002', repeat('f', 64),
      decode('deadbeef', 'hex'), 'GB',
      private.embryo_statement_keys_v1('consent.upload-embryo', 'parent'),
      private.embryo_statement_keys_v1('attestation.embryo-parentage'),
      'nonce-accept-0001-aaaaaaaaaaa')$$,
  '42501', 'address does not match',
  'an account that does not control the invited address cannot accept');
select throws_ok(
  $$select public.accept_embryo_co_parent_invitation_v1(
      repeat('c', 64), '7a000000-0000-0000-0000-000000000001', repeat('a', 64),
      decode('deadbeef', 'hex'), 'GB',
      private.embryo_statement_keys_v1('consent.upload-embryo', 'parent'),
      private.embryo_statement_keys_v1('attestation.embryo-parentage'),
      'nonce-accept-0004-aaaaaaaaaaa')$$,
  '42501', 'draft unavailable',
  'the draft owner cannot accept the co-parent invitation themselves');
select is(
  public.accept_embryo_co_parent_invitation_v1(
    repeat('c', 64), '7a000000-0000-0000-0000-000000000002', repeat('b', 64),
    decode('deadbeef', 'hex'), 'GB',
    private.embryo_statement_keys_v1('consent.upload-embryo', 'parent'),
    private.embryo_statement_keys_v1('attestation.embryo-parentage'),
    'nonce-accept-0002-aaaaaaaaaaa'),
  (select draft_id from draft),
  'the matching co-parent accepts and is bound to the draft');
select is(
  (select sp.account_id from public.subject_principals sp
   where sp.id = (select invitee_principal_id from public.subject_invitations
                  where id = (select invitation_id from inv))),
  '7a000000-0000-0000-0000-000000000002'::uuid,
  'the parent_b principal now belongs to the co-parent account');
select is(
  (select array_agg(s.state order by s.slot_kind)
   from public.draft_participant_slots s
   where s.embryo_draft_id = (select draft_id from draft)),
  array['current', 'current'],
  'both parent slots are current after acceptance');
select is(
  (select count(*) from public.consent_signatures
   where signer_account_id = '7a000000-0000-0000-0000-000000000002'
     and target_id = (select draft_id from draft)),
  2::bigint, 'acceptance records the co-parent''s two Tier-2 signatures');
select throws_ok(
  $$select public.accept_embryo_co_parent_invitation_v1(
      repeat('c', 64), '7a000000-0000-0000-0000-000000000002', repeat('b', 64),
      decode('deadbeef', 'hex'), 'GB',
      private.embryo_statement_keys_v1('consent.upload-embryo', 'parent'),
      private.embryo_statement_keys_v1('attestation.embryo-parentage'),
      'nonce-accept-0003-aaaaaaaaaaa')$$,
  '42501', 'rights session unavailable',
  'a consumed rights session cannot accept again');

-- ---------------------------------------------------------------------------
-- Finalization
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select * from public.finalize_embryo_cohort_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      (select draft_id from draft), null, null, 'nonce-final-0001-aaaaaaaaaaaa')$$,
  '55000', 'consent_required',
  'finalization refuses while artifacts are missing');
select is(
  (select state from public.embryo_cohort_drafts where id = (select draft_id from draft)),
  'draft', 'a refused finalization leaves the draft untouched');

select lives_ok(
  $$select public.sign_embryo_artifact_v1(
      '7a000000-0000-0000-0000-000000000002',
      '7a000000-0000-4000-8000-0000000000b1',
      'cohort_draft', (select draft_id from draft),
      'attestation.embryo-disposition-rights', 1,
      private.embryo_statement_keys_v1('attestation.embryo-disposition-rights'),
      decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0009-aaaaaaaaaaaa')$$,
  'the co-parent attests disposition rights in their own account');

create temporary table acks as
select
  public.sign_embryo_artifact_v1(
    '7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',
    'cohort_draft', (select draft_id from draft),
    'disclosure.insurance-and-discrimination', 1,
    private.embryo_statement_keys_v1('disclosure.insurance-and-discrimination'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0010-aaaaaaaaaaaa') as insurance,
  public.sign_embryo_artifact_v1(
    '7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',
    'cohort_draft', (select draft_id from draft),
    'charter.future-person', 1,
    private.embryo_statement_keys_v1('charter.future-person'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0011-aaaaaaaaaaaa') as charter;
