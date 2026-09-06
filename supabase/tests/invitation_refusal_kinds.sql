begin;
select plan(25);
\ir fixtures/rights_invitation_pending.inc
insert into auth.users(id,email) values
 ('9a000000-0000-0000-0000-000000000003','rights-other-owner@example.invalid');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('9a000000-0000-4000-8000-0000000000a3','9a000000-0000-0000-0000-000000000003',
 clock_timestamp(),clock_timestamp(),'aal1');
insert into public.contact_hmac_indexes(
 contact_reference_id,contact_hmac,hmac_key_revision,status,expires_at)
select contact_reference_id,repeat('e',64),2,'current',clock_timestamp()+interval '10 days'
from public.invitation_candidates where invitation_id=(select invitation_id from inv);

-- Same contact, another active HMAC version and another inviting account.
create temporary table adult as select * from public.create_adult_subject_invitation_v1(
 '9a000000-0000-0000-0000-000000000003',decode('ffeeddccbbaa99887766554433221100','hex'),
 repeat('e',64),repeat('4',64),true);
create temporary table donor_draft as select * from public.create_embryo_cohort_draft_v1(
 '9a000000-0000-0000-0000-000000000003','9a000000-0000-4000-8000-0000000000a3',
 'own_embryos','anonymous_donor',2,decode('00112233445566778899aabbccddeeff','hex'),
 repeat('a',64),'{}'::text[],'{}'::text[],'donor-draft-nonce-aaaaaaaaaaaa',true);
-- Donor issuance is not implemented yet. Seed its declared draft shape to
-- test that global refusal dispatch cannot accidentally delete that draft.
insert into public.subject_principals(id,principal_kind,status)
values('9a000000-0000-0000-0000-0000000000d1','identified_donor','pending');
insert into public.draft_participant_slots(id,embryo_draft_id,slot_kind,principal_id,slot_revision,state)
values('9a000000-0000-0000-0000-0000000000d2',(select draft_id from donor_draft),
 'identified_donor','9a000000-0000-0000-0000-0000000000d1',1,'pending');
insert into public.encrypted_contact_references(
 id,principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,status)
values('9a000000-0000-0000-0000-0000000000d3','9a000000-0000-0000-0000-0000000000d1',
 decode('ffeeddccbbaa99887766554433221100','hex'),repeat('b',64),1,1,'current');
insert into public.subject_invitations(
 id,target_kind,target_id,inviter_principal_id,invitee_principal_id,email_hmac,email_encrypted,
 token_hash,invitation_kind,status,invitation_revision,expires_at)
select '9a000000-0000-0000-0000-0000000000d4','cohort_draft',id,uploader_principal_id,
 '9a000000-0000-0000-0000-0000000000d1',repeat('b',64),
 decode('ffeeddccbbaa99887766554433221100','hex'),repeat('f',64),
 'identified_donor_subject','pending',1,fixed_expires_at
from public.embryo_cohort_drafts where id=(select draft_id from donor_draft);
insert into public.invitation_candidates(invitation_id,draft_slot_id,contact_reference_id,candidate_revision,state)
values('9a000000-0000-0000-0000-0000000000d4','9a000000-0000-0000-0000-0000000000d2',
 '9a000000-0000-0000-0000-0000000000d3',1,'issued');
create temporary table donor_before as select * from public.embryo_cohort_drafts
where id=(select draft_id from donor_draft);

-- A genuine third-party draft has two invited parents. Only the refusing
-- address is barred; the other parent's invitation is merely cancelled.
create temporary table third_party as select * from public.create_embryo_cohort_draft_v1(
 '9a000000-0000-0000-0000-000000000003','9a000000-0000-4000-8000-0000000000a3',
 'with_genetic_parents_permission','true_two_parent',4,
 decode('00112233445566778899aabbccddeeff','hex'),repeat('a',64),
 array['ffeeddccbbaa99887766554433221100','ffeeddccbbaa99887766554433221100'],
 array[repeat('b',64),repeat('d',64)],'third-draft-nonce-aaaaaaaaaaaa',true);
select public.sign_embryo_artifact_v1(
 '9a000000-0000-0000-0000-000000000003','9a000000-0000-4000-8000-0000000000a3',
 'cohort_draft',(select draft_id from third_party),'consent.upload-embryo',1,
 private.embryo_statement_keys_v1('consent.upload-embryo','uploader'),decode('01','hex'),
 'GB','third-sign-nonce-aaaaaaaaaaaa');
create temporary table third_parent_a as select * from public.create_embryo_draft_invitation_v1(
 '9a000000-0000-0000-0000-000000000003','9a000000-0000-4000-8000-0000000000a3',
 (select draft_id from third_party),repeat('b',64),repeat('6',64),'third-invite-a-aaaaaaaaaaaa',true);
create temporary table third_parent_b as select * from public.create_embryo_draft_invitation_v1(
 '9a000000-0000-0000-0000-000000000003','9a000000-0000-4000-8000-0000000000a3',
 (select draft_id from third_party),repeat('d',64),repeat('7',64),'third-invite-b-aaaaaaaaaaaa',true);
select is((select count(*) from public.activate_rights_session_v1(
 (select hash from tok),repeat('c',64),'refusal-kind-form-aaaaaaaaaaaa')),1::bigint,
 'root co-parent invitation activates');
select lives_ok($$select private.refuse_co_parent_invitation_v1(
 repeat('c',64),'refusal-kind-nonce-aaaaaaaaaaaa')$$,
 'one contact refusal dispatches each pending invitation by its immutable kind');
select is((select status from public.subject_invitations where id=(select invitation_id from adult)),
 'refused','the other account adult invitation is refused across the key alias');
select is((select state from public.adult_subject_drafts where subject_id=(select subject_id from adult)),
 'cancelled','the adult draft is cancelled');
select is((select lifecycle from public.subjects where id=(select subject_id from adult)),
 'purge_queued','the unconfirmed adult placeholder loses authority');
select is((select count(*) from public.retention_due_phases
 where retention_id='adult.subject-draft-30d'
 and target_id=(select id from public.adult_subject_drafts where subject_id=(select subject_id from adult))
 and immutable_envelope->>'reason'='invitation-refused'),1::bigint,
 'the adult purge is scoped to its draft, not a live subject graph');
select is((select status from public.subject_invitations where id='9a000000-0000-0000-0000-0000000000d4'),
 'refused','the optional donor invitation is refused');
select is((select state from public.embryo_cohort_drafts where id=(select draft_id from donor_draft)),
 'draft','the donor fallback preserves its draft');
select is((select basis_case from public.embryo_cohort_drafts where id=(select draft_id from donor_draft)),
 'anonymous_donor','the donor fallback has anonymous legal basis');
select is((select embryo_count from public.embryo_cohort_drafts where id=(select draft_id from donor_draft)),
 (select embryo_count from donor_before),'the donor fallback preserves embryo count');
select is((select fixed_expires_at from public.embryo_cohort_drafts where id=(select draft_id from donor_draft)),
 (select fixed_expires_at from donor_before),'the donor fallback preserves the original deadline');
select is((select basis_revision from public.embryo_cohort_drafts where id=(select draft_id from donor_draft)),
 (select basis_revision+1 from donor_before),'the donor fallback invalidates old basis authority');
select is((select donor_attribution_revision from public.embryo_cohort_drafts where id=(select draft_id from donor_draft)),
 (select donor_attribution_revision+1 from donor_before),'the donor fallback invalidates old attribution authority');
select is((select count(*) from public.draft_participant_slots
 where embryo_draft_id=(select draft_id from donor_draft) and slot_kind='parent_a' and state='current'),
 1::bigint,'the donor fallback preserves the real parent slot');
select ok((select principal_id is null and state='revoked' from public.draft_participant_slots
 where id='9a000000-0000-0000-0000-0000000000d2'),'the optional donor slot is cleared');
select ok((select contact_ciphertext is null and status='shredded' from public.encrypted_contact_references
 where id='9a000000-0000-0000-0000-0000000000d3'),'the old donor contact is shredded');
select is((select count(*) from public.retention_due_phases
 where target_id=(select draft_id from donor_draft) and immutable_envelope->>'reason'='invitation-refused'),
 0::bigint,'the donor fallback queues no draft purge');
select is((select count(*) from private.invitation_terminal_notices where recipient_kind='contact'),
 1::bigint,'the contact notice is coalesced across accounts and key versions');
select is((select count(*) from private.invitation_terminal_notices where recipient_kind='account'
 and notice_kind='donor-attribution-ended'),1::bigint,
 'the donor owner notice says only attribution ended, not draft deletion');
select is((select state from public.embryo_cohort_drafts where id=(select draft_id from third_party)),
 'cancelled','the same contact refusal cancels the other account third-party draft');
select is((select status from public.subject_invitations where id=(select invitation_id from third_parent_a)),
 'refused','the same contact third-party invitation is refused');
select is((select status from public.subject_invitations where id=(select invitation_id from third_parent_b)),
 'cancelled','the other parent is cancelled, not recorded as refusing');
select is((select count(*) from public.invitation_refusal_hmacs where email_hmac=repeat('d',64)),
 0::bigint,'collateral draft cancellation does not bar the other parent');
select is((select count(*) from private.invitation_terminal_notices
 where recipient_kind='account' and invitation_id in (
 select invitation_id from third_parent_a union all select invitation_id from third_parent_b)),
 1::bigint,'the draft owner receives only one cancellation notice intent');
select * from finish();
rollback;
