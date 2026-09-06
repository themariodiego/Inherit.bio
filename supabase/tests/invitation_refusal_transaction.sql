begin;
select plan(34);
\ir fixtures/rights_invitation_pending.inc

select is((select count(*) from public.activate_rights_session_v1(
 (select hash from tok),repeat('c',64),'refusal-form-aaaaaaaaaaaaaaaa')),1::bigint,
 'fixture activates a real co-parent rights session');

-- Rollback proof: a notice failure cannot leave a bar, cancellation or purge.
create function pg_temp.reject_notice() returns trigger language plpgsql as $$
begin raise exception using errcode='ZY001',message='synthetic notice failure'; end;
$$;
create trigger synthetic_notice_failure before insert on private.invitation_terminal_notices
for each row execute function pg_temp.reject_notice();
select throws_ok($$select private.refuse_co_parent_invitation_v1(
 repeat('c',64),'refusal-nonce-aaaaaaaaaaaaaaaa')$$,'ZY001','synthetic notice failure',
 'a notice failure rolls back the refusal transaction');
select is((select status from public.subject_invitations where id=(select invitation_id from inv)),
 'pending','notice failure preserves the pending invitation');
select is((select state from public.embryo_cohort_drafts where id=(select draft_id from draft)),
 'draft','notice failure preserves the draft');
select is((select count(*) from public.invitation_refusal_hmacs where email_hmac=repeat('b',64)),
 0::bigint,'notice failure writes no global bar');
drop trigger synthetic_notice_failure on private.invitation_terminal_notices;

create function pg_temp.refuse_after_inviter_retirement(p_status text)
returns void language plpgsql as $$
begin
 begin
  update public.subject_principals set status=p_status,principal_revision=principal_revision+1
  where id=(select inviter_principal_id from public.subject_invitations where id=(select invitation_id from inv));
  perform private.refuse_co_parent_invitation_v1(repeat('c',64),'retired-owner-refusal-aaaaaaaaaaaa');
  raise exception using errcode='ZX002',message='rollback successful probe';
 exception when sqlstate 'ZX002' then null;
 end;
end;
$$;
select lives_ok($$select pg_temp.refuse_after_inviter_retirement('revoked')$$,
 'a revoked inviter cannot prevent the recipient from refusing');
select lives_ok($$select pg_temp.refuse_after_inviter_retirement('deleted')$$,
 'a deleted inviter cannot prevent the recipient from refusing');

-- A second still-active version of this address belongs to the same contact.
insert into public.contact_hmac_indexes(
 contact_reference_id,contact_hmac,hmac_key_revision,status,expires_at)
select contact_reference_id,repeat('e',64),2,'current',clock_timestamp()+interval '10 days'
from public.invitation_candidates where invitation_id=(select invitation_id from inv);
select is(private.invitation_contact_aliases_v1(repeat('b',64)),
 array[repeat('b',64),repeat('e',64)],'stored key versions resolve to one refusal alias set');
-- A bar from an overlapping key version retains its original deadline.
insert into public.invitation_refusal_hmacs(email_hmac,refusal_revision,created_at,expires_at)
values(repeat('e',64),1,clock_timestamp()-interval '3 days',clock_timestamp()+interval '10 days');
create temporary table alias_bar_before as
select expires_at from public.invitation_refusal_hmacs where email_hmac=repeat('e',64);

-- Evidence is frozen by its exact draft binding, not by principal or account.
insert into public.legal_evidence_ingest_sessions(
 id,principal_id,target_kind,target_id,evidence_kind,session_revision,state,expires_at)
select '9a000000-0000-0000-0000-0000000000e1',uploader_principal_id,'cohort_draft',id,
 'embryo-basis',1,'open',clock_timestamp()+interval '1 day'
from public.embryo_cohort_drafts where id=(select draft_id from draft);
insert into public.legal_evidence_fragments(session_id,fragment_ordinal,object_id,sha256,byte_count)
values('9a000000-0000-0000-0000-0000000000e1',1,'9a000000-0000-0000-0000-0000000000f1',repeat('a',64),32);

create temporary table before_refusal as select
 (select count(*) from public.embryo_cohorts) cohorts,
 (select count(*) from public.genome_files) files,
 (select count(*) from public.attestation_contradictions) contradictions,
 (select count(*) from public.subjects) subjects,
 (select fixed_expires_at from public.embryo_cohort_drafts where id=(select draft_id from draft)) draft_deadline;
select lives_ok($$select private.refuse_co_parent_invitation_v1(
 repeat('c',64),'refusal-nonce-aaaaaaaaaaaaaaaa')$$,
 'a current session refuses without any account or country parameter');
select is((select status from public.subject_invitations where id=(select invitation_id from inv)),
 'refused','the exact invitation is refused');
select is((select state from public.embryo_cohort_drafts where id=(select draft_id from draft)),
 'cancelled','the exact draft is cancelled');
select is((select fixed_expires_at from public.embryo_cohort_drafts where id=(select draft_id from draft)),
 (select draft_deadline from before_refusal),'refusal does not extend the draft lifetime');
select is((select status from public.rights_sessions where session_hash=repeat('c',64)),
 'revoked','the rights session is invalidated');
select is((select status from public.token_hashes where token_hash=(select hash from tok)),
 'revoked','the original token remains unusable');
select is((select state from public.token_candidates where target_id=(select invitation_id from inv)),
 'invalidated','the delivery candidate is invalidated');
select is((select state from public.mail_outbox where target_id=(select invitation_id from inv)),
 'invalidated','the claimed invitation mail is cancelled');
select is((select count(*) from public.invitation_refusal_hmacs where email_hmac in (repeat('b',64),repeat('e',64))),
 2::bigint,'both stored key versions are barred');
select ok((select bool_and(expires_at=(select expires_at from alias_bar_before))
 from public.invitation_refusal_hmacs where email_hmac in (repeat('b',64),repeat('e',64))),
 'an overlapping key alias inherits the original bar deadline rather than restarting it');
select is((select count(*) from private.invitation_terminal_notices where invitation_id=(select invitation_id from inv)),
 2::bigint,'one recipient notice and one inviter notice are recorded');
select ok((select bool_and(expires_at=created_at+interval '30 days')
 from private.invitation_terminal_notices where invitation_id=(select invitation_id from inv)),
 'notice contact deadlines are fixed at the terminal event');
select ok((select contact_ciphertext is not null and recipient_account_id is null
 from private.invitation_terminal_notices where invitation_id=(select invitation_id from inv) and recipient_kind='contact'),
 'the accountless recipient notice retains only its encrypted recipient');
select ok((select contact_ciphertext is null and recipient_account_id='9a000000-0000-0000-0000-000000000001'
 from private.invitation_terminal_notices where invitation_id=(select invitation_id from inv) and recipient_kind='account'),
 'the inviter notice is bound to the server-derived owner');
select is((select immutable_envelope->>'reason' from public.retention_due_phases
 where target_id=(select draft_id from draft) and phase_id='embryo-cohort-draft-expiry'),
 'invitation-refused','the exact draft purge is queued');
select is((select object_id from public.purge_manifest_entries
 where manifest_id=(select id from public.purge_manifests where retention_row_id=(
 select id from public.retention_rows where target_id=(select draft_id from draft)
 and retention_id='embryo.cohort-draft-30d'))),
 '9a000000-0000-0000-0000-0000000000f1'::uuid,'only the draft-bound evidence object enters the purge manifest');
select is((select state from public.legal_evidence_ingest_sessions
 where id='9a000000-0000-0000-0000-0000000000e1'),'cancelled','evidence ingest loses authority immediately');
select is((select count(*) from public.embryo_cohorts),(select cohorts from before_refusal),
 'draft refusal does not create or remove a live cohort');
select is((select count(*) from public.genome_files),(select files from before_refusal),
 'draft refusal does not touch a genome file');
select is((select count(*) from public.subjects),(select subjects from before_refusal),
 'co-parent draft refusal does not create or remove a subject');
select is((select count(*) from public.attestation_contradictions),(select contradictions from before_refusal),
 'draft refusal does not create a contradiction');
create temporary table fixed_bar as select expires_at from public.invitation_refusal_hmacs where email_hmac=repeat('b',64);
select lives_ok($$select private.refuse_co_parent_invitation_v1(
 repeat('c',64),'refusal-nonce-aaaaaaaaaaaaaaaa')$$,'the same operation retry is acknowledged');
select is((select expires_at from public.invitation_refusal_hmacs where email_hmac=repeat('b',64)),
 (select expires_at from fixed_bar),'a retry never refreshes the refusal bar');
select is((select count(*) from private.invitation_terminal_notices where invitation_id=(select invitation_id from inv)),
 2::bigint,'a retry never duplicates the notices');
select ok(not has_function_privilege('service_role','private.refuse_co_parent_invitation_v1(text,text)','execute')
 and not has_function_privilege('authenticated','private.refuse_co_parent_invitation_v1(text,text)','execute'),
 'the incomplete workflow is not exposed to API callers');
select * from finish();
rollback;
