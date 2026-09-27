begin;
select plan(36);
-- Isolate the real mail claimer inside this rollback-only synthetic fixture.
update public.mail_outbox set state='invalidated' where state in ('queued','claimed');
insert into auth.users(id,email,raw_user_meta_data) values
 ('7d000000-0000-4000-8000-000000000001','delete-inviter-a@example.invalid','{"display_name":"Inviter A"}'),
 ('7d000000-0000-4000-8000-000000000002','delete-inviter-b@example.invalid','{"display_name":"Inviter B"}');

create function pg_temp.issue(p_account uuid,p_contact text,p_label text,p_open boolean)
returns table(invitation_id uuid,subject_id uuid,token_hash text,session_hash text)
language plpgsql as $$
declare i record; raw_token text; token_digest text; session_digest text; opened bigint;
begin
 select * into strict i from public.create_adult_subject_invitation_v1(p_account,
  decode('00112233445566778899aabbccddeeff','hex'),p_contact,
  encode(extensions.digest(p_label,'sha256'),'hex'),true);
 if i.invitation_id is null then raise exception 'fixture invitation was not issued'; end if;
 select delivery_token into strict raw_token from public.claim_mail_outbox();
 token_digest:=encode(extensions.digest(raw_token,'sha256'),'hex');
 if not exists(select 1 from public.token_hashes th join public.token_candidates tc on tc.id=th.candidate_id
  where th.token_hash=token_digest and tc.target_id=i.invitation_id) then
  raise exception 'fixture mail does not belong to invitation';
 end if;
 session_digest:=encode(extensions.digest(p_label||'-session','sha256'),'hex');
 if p_open then
  select count(*) into opened from public.activate_rights_session_v1(token_digest,session_digest,'pending-delete-open-'||p_label);
  if opened<>1 then raise exception 'fixture rights session did not open'; end if;
 end if;
 return query select i.invitation_id,i.subject_id,token_digest,session_digest;
end;
$$;

create temporary table session_delete as select * from pg_temp.issue(
 '7d000000-0000-4000-8000-000000000001',repeat('a',64),'current-delete',true);
create temporary table independent as select * from pg_temp.issue(
 '7d000000-0000-4000-8000-000000000002',repeat('d',64),'independent',false);
create temporary table independent_before as
 select to_jsonb(i) as invitation,to_jsonb(s) as subject from public.subject_invitations i
 join public.subjects s on s.id=i.target_id where i.id=(select invitation_id from independent);

select is((select count(*) from public.genome_files where subject_id=(select subject_id from session_delete)),
 0::bigint,'the deleted reservation has no genome source; this is not a held-data deletion proof');
select is(public.respond_adult_subject_invitation_session_v1(
 (select session_hash from session_delete),'delete','pending-delete-current-operation'),
 'deleted','the exact current rights session deletes its reservation without an account');
select is((select status from public.subject_invitations where id=(select invitation_id from session_delete)),
 'revoked','delete keeps the existing distinct invitation terminal state');
select is((select lifecycle from public.subjects where id=(select subject_id from session_delete)),
 'purged','delete closes only the reserved subject');
select is((select count(*) from public.subject_principals where subject_id=(select subject_id from session_delete) and status='deleted'),
 1::bigint,'the pending principal is terminal rather than promoted');
select is((select count(*) from public.encrypted_contact_references where contact_hmac=repeat('a',64)
 and status='shredded' and contact_ciphertext is null),1::bigint,'delete still shreds its stored contact');
select is((select count(*) from public.contact_hmac_indexes hi join public.encrypted_contact_references e on e.id=hi.contact_reference_id
 where e.contact_hmac=repeat('a',64) and hi.status='current'),0::bigint,'delete revokes its current contact index');
select is((select status from public.rights_sessions where session_hash=(select session_hash from session_delete)),
 'consumed','delete consumes the exact rights session');
select is((select status from public.token_hashes where token_hash=(select token_hash from session_delete)),
 'consumed','the original mailed token stays consumed');
select is((select tc.state from public.token_candidates tc join public.token_hashes th on th.candidate_id=tc.id
 where th.token_hash=(select token_hash from session_delete)),'invalidated','delete invalidates its candidate');
select is((select count(*) from public.adult_subject_drafts where subject_id=(select subject_id from session_delete)),
 0::bigint,'delete removes its reserved draft');
select is((select count(*) from public.invitation_refusal_hmacs where email_hmac=repeat('a',64)),
 0::bigint,'delete does not create the global invitation refusal HMAC');
select is((select count(*) from public.contact_refusal_bars where contact_hmac=repeat('a',64)),
 0::bigint,'delete does not create the second globally consulted refusal store');
select ok(not private.invitation_contact_barred_v1(repeat('a',64)),
 'the actual global predicate does not treat deletion alone as refusal');
select is((select count(*) from public.purpose_grants where target_id=(select subject_id from session_delete)),
 0::bigint,'deletion creates no genetic-data purpose grant');
select is((select count(*) from public.consent_signatures where target_id=(select subject_id from session_delete)),
 0::bigint,'deletion does not forge adult consent');
select is((select row(to_jsonb(i),to_jsonb(s))::text from public.subject_invitations i join public.subjects s on s.id=i.target_id
 where i.id=(select invitation_id from independent)),
 (select row(invitation,subject)::text from independent_before),'another invitation and subject are unchanged');
select is(public.respond_adult_subject_invitation_session_v1(
 (select session_hash from session_delete),'delete','pending-delete-current-operation'),
 'unavailable','the spent session cannot replay deletion');
select is(public.respond_adult_subject_invitation_v1((select token_hash from session_delete),'confirm',
 '7d000000-0000-4000-8000-000000000002',repeat('a',64)),
 'unavailable','the old token cannot accept or revive the deleted reservation');

create temporary table reinvited as select * from pg_temp.issue(
 '7d000000-0000-4000-8000-000000000002',repeat('a',64),'after-current-delete',true);
select ok((select invitation_id is not null and invitation_id<>(select invitation_id from session_delete) from reinvited),
 'a different inviter can issue a real new invitation after deletion');
select is((select status from public.rights_sessions where session_hash=(select session_hash from reinvited)),
 'active','the new invitation activates only its own current authority');
select is((select lifecycle from public.subjects where id=(select subject_id from session_delete)),
 'purged','reinvitation does not revive the old subject');

-- Expired matching bars and an unrelated live bar must not be erased or renewed.
insert into public.invitation_refusal_hmacs(email_hmac,refusal_revision,created_at,expires_at) values
 (repeat('b',64),7,clock_timestamp()-interval '366 days',clock_timestamp()-interval '1 day'),
 (repeat('e',64),9,clock_timestamp()-interval '1 day',clock_timestamp()+interval '100 days');
insert into public.contact_refusal_bars(contact_hmac,target_kind,target_id,refusal_revision,created_at,expires_at) values
 (repeat('b',64),'subject','7d000000-0000-4000-8000-000000000090',7,clock_timestamp()-interval '366 days',clock_timestamp()-interval '1 day'),
 (repeat('e',64),'subject','7d000000-0000-4000-8000-000000000091',9,clock_timestamp()-interval '1 day',clock_timestamp()+interval '100 days');
create temporary table bars_before as
 select 'invitation' as store,to_jsonb(b) as value from public.invitation_refusal_hmacs b where email_hmac in(repeat('b',64),repeat('e',64))
 union all select 'contact',to_jsonb(b) from public.contact_refusal_bars b where contact_hmac in(repeat('b',64),repeat('e',64));
create temporary table legacy_delete as select * from pg_temp.issue(
 '7d000000-0000-4000-8000-000000000001',repeat('b',64),'legacy-delete',false);
select is(public.respond_adult_subject_invitation_v1((select token_hash from legacy_delete),'delete'),
 'deleted','the legacy mailed-token facade preserves accountless deletion');
select is((select lifecycle from public.subjects where id=(select subject_id from legacy_delete)),
 'purged','legacy deletion still closes the reserved subject');
select is((select count(*) from public.encrypted_contact_references where contact_hmac=repeat('b',64)
 and contact_ciphertext is null and status='shredded'),1::bigint,'legacy deletion still shreds contact ciphertext');
select results_eq($$select store,value from (
 select 'invitation' as store,to_jsonb(b) as value from public.invitation_refusal_hmacs b where email_hmac in(repeat('b',64),repeat('e',64))
 union all select 'contact',to_jsonb(b) from public.contact_refusal_bars b where contact_hmac in(repeat('b',64),repeat('e',64))
 ) x order by store,value::text$$,$$select store,value from bars_before order by store,value::text$$,
 'delete leaves expired matching and unrelated live bar rows byte-for-byte unchanged');
select ok(not private.invitation_contact_barred_v1(repeat('b',64)) and private.invitation_contact_barred_v1(repeat('e',64)),
 'delete neither revives an expired bar nor removes an independent live bar');
select is(public.respond_adult_subject_invitation_v1((select token_hash from legacy_delete),'delete'),
 'unavailable','the legacy token cannot replay deletion');
create temporary table legacy_reinvited as select * from pg_temp.issue(
 '7d000000-0000-4000-8000-000000000002',repeat('b',64),'after-legacy-delete',false);
select ok((select invitation_id is not null and invitation_id<>(select invitation_id from legacy_delete) from legacy_reinvited),
 'another inviter can issue a real new invitation after legacy deletion');

-- Explicit refusal still opts into the complete global bar on both paths.
select is(public.respond_adult_subject_invitation_session_v1(
 (select session_hash from reinvited),'refuse','pending-delete-control-refusal'),
 'refused','the replacement recipient can still explicitly refuse without an account');
select is((select count(*) from public.invitation_refusal_hmacs where email_hmac=repeat('a',64) and expires_at>clock_timestamp()),
 1::bigint,'session refusal still records the first live global bar');
select is((select count(*) from public.contact_refusal_bars where contact_hmac=repeat('a',64) and expires_at>clock_timestamp()),
 1::bigint,'session refusal still records the second live global bar');
create temporary table blocked as select * from public.create_adult_subject_invitation_v1(
 '7d000000-0000-4000-8000-000000000001',decode('00112233445566778899aabbccddeeff','hex'),repeat('a',64),
 encode(extensions.digest('after-explicit-refusal','sha256'),'hex'),true);
select ok((select invitation_id is null and subject_id is null from blocked),
 'explicit refusal remains a real global bar for a different inviter');
select is(public.respond_adult_subject_invitation_v1((select token_hash from legacy_reinvited),'refuse'),
 'refused','legacy explicit refusal is preserved too');
select ok(private.invitation_contact_barred_v1(repeat('b',64))
 and exists(select 1 from public.invitation_refusal_hmacs where email_hmac=repeat('b',64) and refusal_revision=8)
 and exists(select 1 from public.contact_refusal_bars where contact_hmac=repeat('b',64) and expires_at>clock_timestamp()),
 'only explicit legacy refusal renews the expired invitation HMAC and creates its live contact bar');
select ok(not has_function_privilege('anon','private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)','execute')
 and not has_function_privilege('authenticated','private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)','execute')
 and not has_function_privilege('service_role','private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)','execute'),
 'the shared privileged transaction remains inaccessible to API roles');
select * from finish();
rollback;
