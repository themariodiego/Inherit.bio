begin;
select plan(38);

-- Only synthetic accounts; the outer transaction rolls back.
insert into auth.users (id, email, raw_user_meta_data) values
 ('7b000000-0000-0000-0000-000000000001','adult-inviter@example.invalid','{"display_name":"Inviter"}'),
 ('7b000000-0000-0000-0000-000000000002','adult-subject@example.invalid','{"display_name":"Invited"}');

-- `claim_mail_outbox` takes the oldest deliverable row, so a developer
-- database holding other queued mail would hand this suite someone else's
-- token. Retiring those rows inside the test transaction makes every claim
-- below deterministic wherever the suite runs; the rollback puts them back.
update public.mail_outbox set state='invalidated' where state in ('queued','claimed');

create temporary table inv as
select * from public.create_adult_subject_invitation_v1(
 '7b000000-0000-0000-0000-000000000001',
 decode('00112233445566778899aabbccddeeff','hex'),
 repeat('a',64), repeat('b',64), true
);
create temporary table delivery as select * from public.claim_mail_outbox();
create temporary table tok as select encode(extensions.digest(
 convert_to((select delivery_token from delivery),'UTF8'),'sha256'),'hex') as hash;

select is((select target_id from public.token_candidates
 where id = (select candidate_id from public.token_hashes where token_hash=(select hash from tok))),
 (select invitation_id from inv), 'fixture uses the actual invitation mail token');

-- Each probe rolls back both its mutation and the attempted activation, even
-- when the activation succeeds. The result is retained in the PL/pgSQL variable.
create function pg_temp.probe(p_mutation text)
returns text language plpgsql as $$
declare v_result text;
begin
 begin
  execute p_mutation;
  select count(*)::text into v_result from public.activate_rights_session_v1(
   (select hash from tok), repeat('c',64), 'adult-form-probe-aaaaaaaaaaaa');
  raise exception using errcode='ZX001', message='probe rollback';
 exception when sqlstate 'ZX001' then null;
 when others then v_result := sqlstate;
 end;
 return v_result;
end;
$$;

create temporary table mutations (name text, command text);
insert into mutations values
 ('token revision', $$update public.token_hashes set token_revision=2 where token_hash=(select hash from tok)$$),
 ('candidate purpose', $$update public.token_candidates set purpose='co-parent-invitation' where target_id=(select invitation_id from inv)$$),
 ('candidate kind', $$update public.token_candidates set target_kind='cohort_draft' where target_id=(select invitation_id from inv)$$),
 ('candidate state', $$update public.token_candidates set state='invalidated' where target_id=(select invitation_id from inv)$$),
 ('candidate expiry', $$update public.token_candidates set expires_at=clock_timestamp()-interval '1 second' where target_id=(select invitation_id from inv)$$),
 ('replacement token', $$update public.subject_invitations set token_hash=repeat('f',64) where id=(select invitation_id from inv)$$),
 ('invitation revision', $$update public.subject_invitations set invitation_revision=2 where id=(select invitation_id from inv)$$),
 ('invitation kind', $$update public.subject_invitations set invitation_kind='identified_donor_subject' where id=(select invitation_id from inv)$$),
 ('invitation target kind', $$update public.subject_invitations set target_kind='cohort_draft' where id=(select invitation_id from inv)$$),
 ('invitation expiry', $$update public.subject_invitations set created_at=clock_timestamp()-interval '1 day',expires_at=clock_timestamp()-interval '1 second' where id=(select invitation_id from inv)$$),
 ('contact revision', $$update public.encrypted_contact_references set authority_revision=2 where principal_id=(select invitee_principal_id from public.subject_invitations where id=(select invitation_id from inv))$$),
 ('contact address', $$update public.encrypted_contact_references set contact_hmac=repeat('e',64) where principal_id=(select invitee_principal_id from public.subject_invitations where id=(select invitation_id from inv))$$),
 ('contact shredding', $$update public.encrypted_contact_references set status='shredded',contact_ciphertext=null where principal_id=(select invitee_principal_id from public.subject_invitations where id=(select invitation_id from inv))$$),
 ('slot revision candidate', $$update public.invitation_candidates set candidate_revision=2 where invitation_id=(select invitation_id from inv)$$),
 ('candidate already answered', $$update public.invitation_candidates set state='refused' where invitation_id=(select invitation_id from inv)$$),
 ('slot withdrawn', $$update public.draft_participant_slots set state='revoked' where adult_draft_id=(select id from public.adult_subject_drafts where subject_id=(select subject_id from inv))$$),
 ('slot kind', $$update public.draft_participant_slots set slot_kind='parent_a' where adult_draft_id=(select id from public.adult_subject_drafts where subject_id=(select subject_id from inv))$$),
 ('principal already active', $$update public.subject_principals set status='active' where id=(select invitee_principal_id from public.subject_invitations where id=(select invitation_id from inv))$$),
 ('principal kind', $$update public.subject_principals set principal_kind='future_person' where id=(select invitee_principal_id from public.subject_invitations where id=(select invitation_id from inv))$$),
 ('cancelled draft', $$update public.adult_subject_drafts set state='cancelled' where subject_id=(select subject_id from inv)$$),
 ('expired draft', $$update public.adult_subject_drafts set fixed_expires_at=clock_timestamp()-interval '1 second' where subject_id=(select subject_id from inv)$$),
 ('contact refusal bar', $$insert into public.contact_refusal_bars(contact_hmac,target_kind,target_id,refusal_revision,expires_at) values(repeat('a',64),'subject',(select subject_id from inv),1,clock_timestamp()+interval '1 day')$$),
 ('global refusal hash', $$insert into public.invitation_refusal_hmacs(email_hmac,refusal_revision,expires_at) values(repeat('a',64),1,clock_timestamp()+interval '1 day')$$);

select is(pg_temp.probe('select 1'),'1','the current adult token can activate a rights session');
select is(pg_temp.probe(command),'0','adult activation rejects '||name) from mutations order by name;
select is((select count(*) from public.rights_sessions where session_hash=repeat('c',64)),0::bigint,
 'activation probes leave no session behind');

select is((select count(*) from public.activate_rights_session_v1(
 (select hash from tok),repeat('d',64),'adult-form-real-aaaaaaaaaaaa')),1::bigint,
 'the unchanged original token still activates after rejected attempts');
select is((select purpose from public.rights_sessions where session_hash=repeat('d',64)),
 'adult-subject-invitation','the session carries the adult purpose, not the co-parent one');
select is((select target_kind from public.rights_sessions where session_hash=repeat('d',64)),
 'subject','the session targets the reserved subject');
select is((select target_id from public.rights_sessions where session_hash=repeat('d',64)),
 (select subject_id from inv),'the session target is the invitation subject');
select is((select principal_id from public.rights_sessions where session_hash=repeat('d',64)),
 (select invitee_principal_id from public.subject_invitations where id=(select invitation_id from inv)),
 'the session principal is the invited adult');
select is((select authority_revision from public.rights_sessions where session_hash=repeat('d',64)),
 (select invitation_revision from public.subject_invitations where id=(select invitation_id from inv)),
 'the session records the exact invitation revision');
select is((select status from public.token_hashes where token_hash=(select hash from tok)),
 'consumed','activation spends the mailed token');
select is((select count(*) from public.activate_rights_session_v1(
 (select hash from tok),repeat('e',64),'adult-form-replay-aaaaaaaaaaa')),0::bigint,
 'the spent token cannot open a second session');
select is((select lifecycle from public.subjects where id=(select subject_id from inv)),
 'draft','activation alone does not activate the reserved subject');
select is((select status from public.subject_invitations where id=(select invitation_id from inv)),
 'pending','activation alone does not answer the invitation');
select is((select count(*) from public.legal_audit_log
 where event_code='rights.session.activated'
  and coded_context->>'purpose'='adult-subject-invitation'),1::bigint,
 'activation records one adult rights-session audit event');
select ok(not has_function_privilege('anon','private.current_adult_subject_invitation_v1(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','private.current_adult_subject_invitation_v1(uuid,uuid)','execute')
 and not has_function_privilege('service_role','private.current_adult_subject_invitation_v1(uuid,uuid)','execute'),
 'the private adult authority resolver is not directly executable by API roles');
select * from finish();
rollback;
