begin;
select plan(48);

\ir fixtures/rights_invitation_pending.inc

-- Each probe rolls back both its mutation and the attempted operation, even
-- when the operation succeeds. The result is retained in the PL/pgSQL variable.
create function pg_temp.probe(p_mutation text, p_activate boolean)
returns text language plpgsql as $$
declare v_result text;
begin
 begin
  execute p_mutation;
  if p_activate then
   select count(*)::text into v_result from public.activate_rights_session_v1(
    (select hash from tok), repeat('c',64), 'rights-form-probe-aaaaaaaaaaaa');
  else
   perform public.accept_embryo_co_parent_invitation_v1(
    repeat('c',64), '9a000000-0000-0000-0000-000000000002', repeat('b',64),
    decode('02','hex'), 'GB',
    private.embryo_statement_keys_v1('consent.upload-embryo','parent'),
    private.embryo_statement_keys_v1('attestation.embryo-parentage'),
    'rights-accept-probe-aaaaaaaaaaaa');
   v_result := 'accepted';
  end if;
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
 ('candidate purpose', $$update public.token_candidates set purpose='adult-subject-invitation' where target_id=(select invitation_id from inv)$$),
 ('candidate kind', $$update public.token_candidates set target_kind='cohort_draft' where target_id=(select invitation_id from inv)$$),
 ('candidate state', $$update public.token_candidates set state='invalidated' where target_id=(select invitation_id from inv)$$),
 ('candidate expiry', $$update public.token_candidates set expires_at=clock_timestamp()-interval '1 second' where target_id=(select invitation_id from inv)$$),
 ('replacement token', $$update public.subject_invitations set token_hash=repeat('f',64) where id=(select invitation_id from inv)$$),
 ('invitation revision', $$update public.subject_invitations set invitation_revision=2 where id=(select invitation_id from inv)$$),
 ('invitation kind', $$update public.subject_invitations set invitation_kind='identified_donor_subject' where id=(select invitation_id from inv)$$),
 ('invitation target kind', $$update public.subject_invitations set target_kind='cohort' where id=(select invitation_id from inv)$$),
 ('invitation expiry', $$update public.subject_invitations set created_at=clock_timestamp()-interval '1 day',expires_at=clock_timestamp()-interval '1 second' where id=(select invitation_id from inv)$$),
 ('contact revision', $$update public.encrypted_contact_references set authority_revision=2 where principal_id=(select invitee_principal_id from public.subject_invitations where id=(select invitation_id from inv))$$),
 ('contact address', $$update public.encrypted_contact_references set contact_hmac=repeat('e',64) where principal_id=(select invitee_principal_id from public.subject_invitations where id=(select invitation_id from inv))$$),
 ('contact shredding', $$update public.encrypted_contact_references set status='shredded',contact_ciphertext=null where principal_id=(select invitee_principal_id from public.subject_invitations where id=(select invitation_id from inv))$$),
 ('slot revision candidate', $$update public.invitation_candidates set candidate_revision=2 where invitation_id=(select invitation_id from inv)$$),
 ('slot withdrawn', $$update public.draft_participant_slots set state='revoked' where embryo_draft_id=(select draft_id from draft) and state='pending'$$),
 ('cancelled draft', $$update public.embryo_cohort_drafts set state='cancelled' where id=(select draft_id from draft)$$),
 ('contact refusal bar', $$insert into public.contact_refusal_bars(contact_hmac,target_kind,target_id,refusal_revision,expires_at) values(repeat('b',64),'cohort_draft',(select draft_id from draft),1,clock_timestamp()+interval '1 day')$$),
 ('global refusal hash', $$insert into public.invitation_refusal_hmacs(email_hmac,refusal_revision,expires_at) values(repeat('b',64),1,clock_timestamp()+interval '1 day')$$);

select is(pg_temp.probe('select 1',true),'1','current token can activate');
select is(pg_temp.probe(command,true),'0','activation rejects '||name) from mutations order by name;
select is((select count(*) from public.rights_sessions where session_hash=repeat('c',64)),0::bigint,
 'activation probes leave no session behind');

select is((select count(*) from public.activate_rights_session_v1(
 (select hash from tok),repeat('c',64),'rights-form-real-aaaaaaaaaaaa')),1::bigint,
 'the unchanged original token still activates after rejected attempts');
select is(pg_temp.probe('select 1',false),'accepted','the exact current session can accept');
select is(pg_temp.probe(command,false),'42501','acceptance rejects '||name) from mutations order by name;
select is(pg_temp.probe(
 $$update public.rights_sessions set authority_revision=2 where session_hash=repeat('c',64)$$,false),
 '42501','acceptance checks the session invitation revision');
select is(pg_temp.probe(
 $$update public.rights_sessions set target_kind='subject' where session_hash=repeat('c',64)$$,false),
 '42501','acceptance checks the session target kind');

-- Reproduce the original bug: a new pending invitation for the same exact
-- principal and draft must never inherit the old session's authority.
select is(pg_temp.probe($mutation$
 update public.subject_invitations set status='cancelled',terminal_at=clock_timestamp()
 where id=(select invitation_id from inv);
 insert into public.subject_invitations(
 target_kind,target_id,inviter_principal_id,invitee_principal_id,email_hmac,
 token_hash,invitation_kind,status,invitation_revision,expires_at)
 select target_kind,target_id,inviter_principal_id,invitee_principal_id,email_hmac,
 repeat('f',64),invitation_kind,'pending',invitation_revision,expires_at
 from public.subject_invitations where id=(select invitation_id from inv)
 $mutation$,false),'42501','old session cannot accept a replacement invitation for the same parent and draft');

select is((select count(*) from public.consent_signatures
 where signer_account_id='9a000000-0000-0000-0000-000000000002'),0::bigint,
 'no rejected attempt writes a signature');
select is((select status from public.subject_invitations where id=(select invitation_id from inv)),
 'pending','the invitation stays pending after all rejected attempts');
select is((select state from public.draft_participant_slots
 where embryo_draft_id=(select draft_id from draft) and slot_kind='parent_b'),
 'pending','the parent slot stays pending');
select ok(not has_function_privilege('anon','private.current_co_parent_invitation_v1(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','private.current_co_parent_invitation_v1(uuid,uuid)','execute')
 and not has_function_privilege('service_role','private.current_co_parent_invitation_v1(uuid,uuid)','execute'),
 'the private authority resolver is not directly executable by API roles');
select * from finish();
rollback;
