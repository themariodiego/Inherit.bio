begin;
select plan(24);
-- `claim_mail_outbox` takes the oldest deliverable row, so a developer
-- database holding other queued mail would hand this suite someone else's
-- token. Retiring those rows inside the test transaction makes every claim
-- below deterministic wherever the suite runs; the rollback puts them back.
update public.mail_outbox set state='invalidated' where state in ('queued','claimed');

-- Only synthetic accounts; the outer transaction rolls back.
insert into auth.users (id, email, raw_user_meta_data) values
 ('7c000000-0000-0000-0000-000000000001','session-inviter@example.invalid','{"display_name":"Inviter"}'),
 ('7c000000-0000-0000-0000-000000000002','session-adult@example.invalid','{"display_name":"Invited"}');

create temporary table inv as
select * from public.create_adult_subject_invitation_v1(
 '7c000000-0000-0000-0000-000000000001',
 decode('00112233445566778899aabbccddeeff','hex'),
 repeat('a',64), repeat('b',64), true
);
create temporary table delivery as select * from public.claim_mail_outbox();
create temporary table tok as select encode(extensions.digest(
 convert_to((select delivery_token from delivery),'UTF8'),'sha256'),'hex') as hash;

select is((select target_id from public.token_candidates
 where id = (select candidate_id from public.token_hashes where token_hash=(select hash from tok))),
 (select invitation_id from inv), 'fixture uses the actual invitation mail token');

select is((select count(*) from public.activate_rights_session_v1(
 (select hash from tok), repeat('d',64), 'adult-session-open-aaaaaaaaaa')),1::bigint,
 'the mailed adult token opens one rights session');

-- Nothing about the invitation reaches a caller who does not hold the session.
select is(public.respond_adult_subject_invitation_session_v1(
 repeat('9',64),'confirm','adult-session-unknown-aaaaaaa',
 '7c000000-0000-0000-0000-000000000002', repeat('a',64)),
 'unavailable','an unknown session hash answers nothing');
select is(public.respond_adult_subject_invitation_session_v1(
 'not-a-session-hash','confirm','adult-session-malformed-aaaaa',
 '7c000000-0000-0000-0000-000000000002', repeat('a',64)),
 'unavailable','a malformed session hash answers nothing');

select is(public.respond_adult_subject_invitation_session_v1(
 repeat('d',64),'confirm','adult-session-wrong-mail-aaaa',
 '7c000000-0000-0000-0000-000000000002', repeat('f',64)),
 'unavailable','an account whose authenticated email does not match cannot accept');
select is((select status from public.rights_sessions where session_hash=repeat('d',64)),
 'active','a refused attempt leaves the session open for the right holder');

-- One served form answers at most once, whether or not its attempt succeeded.
create function pg_temp.replay()
returns text language plpgsql as $$
declare v_result text;
begin
 begin
  v_result := public.respond_adult_subject_invitation_session_v1(
   repeat('d',64),'confirm','adult-session-wrong-mail-aaaa',
   '7c000000-0000-0000-0000-000000000002', repeat('a',64));
 exception when others then v_result := sqlstate;
 end;
 return v_result;
end;
$$;
select is(pg_temp.replay(),'23505','a replayed form nonce cannot answer again');

select is(public.respond_adult_subject_invitation_session_v1(
 repeat('d',64),'confirm','adult-session-accept-aaaaaaaa',
 '7c000000-0000-0000-0000-000000000002', repeat('a',64)),
 'accepted','the matching adult account accepts through the session');
select is((select subject_account_id from public.subjects where id=(select subject_id from inv)),
 '7c000000-0000-0000-0000-000000000002'::uuid,
 'acceptance binds control to the invited adult');
select is((select lifecycle from public.subjects where id=(select subject_id from inv)),
 'active','acceptance activates the reserved subject');
select is((select count(*) from public.consent_signatures
 where target_id=(select subject_id from inv) and artifact_key='consent.subject-adult'),
 1::bigint,'acceptance records the exact adult consent artifact once');
select is((select count(*) from public.purpose_grants where target_id=(select subject_id from inv)),
 0::bigint,'acceptance still grants the inviter no genetic-data purpose');
select is((select status from public.subject_invitations where id=(select invitation_id from inv)),
 'accepted','the invitation is answered');
select is((select status from public.rights_sessions where session_hash=repeat('d',64)),
 'consumed','answering spends the rights session');
select is(public.respond_adult_subject_invitation_session_v1(
 repeat('d',64),'confirm','adult-session-again-aaaaaaaaa',
 '7c000000-0000-0000-0000-000000000002', repeat('a',64)),
 'unavailable','the spent session cannot answer twice');
select is(public.respond_adult_subject_invitation_v1(
 (select hash from tok),'confirm',
 '7c000000-0000-0000-0000-000000000002', repeat('a',64)),
 'unavailable','the mailed token cannot answer after its session did');

-- A second invitation, refused through its session.
create temporary table inv2 as
select * from public.create_adult_subject_invitation_v1(
 '7c000000-0000-0000-0000-000000000001',
 decode('ffeeddccbbaa99887766554433221100','hex'),
 repeat('c',64), repeat('e',64), true
);
create temporary table delivery2 as select * from public.claim_mail_outbox();
create temporary table tok2 as select encode(extensions.digest(
 convert_to((select delivery_token from delivery2),'UTF8'),'sha256'),'hex') as hash;
select is((select target_id from public.token_candidates
 where id = (select candidate_id from public.token_hashes where token_hash=(select hash from tok2))),
 (select invitation_id from inv2), 'the second fixture uses its own invitation mail token');
select is((select count(*) from public.activate_rights_session_v1(
 (select hash from tok2), repeat('7',64), 'adult-session-open-bbbbbbbbbb')),1::bigint,
 'the second mailed token opens its own rights session');

select is(public.respond_adult_subject_invitation_session_v1(
 repeat('7',64),'refuse','adult-session-refuse-aaaaaaaa'),
 'refused','refusing needs no account and no jurisdiction');
select is((select lifecycle from public.subjects where id=(select subject_id from inv2)),
 'purged','refusal closes the empty reserved subject');
select is((select count(*) from public.encrypted_contact_references
 where contact_hmac=repeat('c',64) and status='current'),0::bigint,
 'refusal shreds the stored contact');
select is((select count(*) from public.contact_refusal_bars
 where contact_hmac=repeat('c',64) and expires_at>clock_timestamp()),1::bigint,
 'refusal bars this address for this target');
select is((select status from public.rights_sessions where session_hash=repeat('7',64)),
 'consumed','refusing spends the rights session too');

select ok(not has_function_privilege('anon','private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)','execute')
 and not has_function_privilege('authenticated','private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)','execute')
 and not has_function_privilege('service_role','private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)','execute'),
 'the shared response body is not directly executable by API roles');
select * from finish();
rollback;
