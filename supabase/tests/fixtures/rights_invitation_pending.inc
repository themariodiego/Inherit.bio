-- Only synthetic accounts and invitations; the outer transaction rolls back.
insert into auth.users (id, email) values
 ('9a000000-0000-0000-0000-000000000001', 'rights-owner@example.invalid'),
 ('9a000000-0000-0000-0000-000000000002', 'rights-parent@example.invalid');
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
 ('9a000000-0000-4000-8000-0000000000a1', '9a000000-0000-0000-0000-000000000001',
  clock_timestamp(), clock_timestamp(), 'aal1');
create temporary table draft as
select * from public.create_embryo_cohort_draft_v1(
 '9a000000-0000-0000-0000-000000000001', '9a000000-0000-4000-8000-0000000000a1',
 'own_embryos', 'true_two_parent', 3, decode('00112233445566778899aabbccddeeff','hex'), repeat('a',64),
 array['ffeeddccbbaa99887766554433221100'], array[repeat('b',64)], 'rights-draft-nonce-aaaaaaaaaaaa', true
);
select public.sign_embryo_artifact_v1(
 '9a000000-0000-0000-0000-000000000001', '9a000000-0000-4000-8000-0000000000a1',
 'cohort_draft', (select draft_id from draft), 'consent.upload-embryo', 1,
 private.embryo_statement_keys_v1('consent.upload-embryo','parent'), decode('01','hex'),
 'GB', 'rights-sign-nonce-aaaaaaaaaaaa'
);
create temporary table inv as select * from public.create_embryo_draft_invitation_v1(
 '9a000000-0000-0000-0000-000000000001', '9a000000-0000-4000-8000-0000000000a1',
 (select draft_id from draft), repeat('b',64), repeat('3',64),
 'rights-invite-nonce-aaaaaaaaaaaa', true
);
create temporary table delivery as select * from public.claim_mail_outbox();
create temporary table tok as select encode(extensions.digest(
 convert_to((select delivery_token from delivery),'UTF8'),'sha256'),'hex') as hash;
select is((select target_id from public.token_candidates
 where id = (select candidate_id from public.token_hashes where token_hash=(select hash from tok))),
 (select invitation_id from inv), 'fixture uses the actual invitation mail token');
