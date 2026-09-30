begin;
select no_plan();
-- Actual synthetic canonical publication, with no external provider calls.
\ir fixtures/future_person_custody_source.inc
create temporary table recipients as select distinct p.id from public.subject_principals p
 where p.id=any(private.embryo_cohort_set_v1((select cohort_id from live),'notice_recipients'));
create function pg_temp.request(p_key text) returns uuid language sql as $$
 select deletion_id from public.request_account_deletion_v2(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 repeat(p_key,64),clock_timestamp()+interval '9 minutes',decode('0011223344556677','hex'),repeat('2',64),
 encode(extensions.digest('holder:'||p_key,'sha256'),'hex'));
$$;
create function pg_temp.bad_contact(p_kind text) returns uuid language plpgsql as $$
declare recipient uuid;
begin
 select id into recipient from recipients order by id limit 1;
 if p_kind='missing' then
  update public.encrypted_contact_references set status='rotated',ended_at=clock_timestamp()
   where principal_id=recipient and status='current';
 elsif p_kind='stale' then
  update public.encrypted_contact_references set authority_revision=authority_revision+1
   where principal_id=recipient and status='current';
 else
  insert into public.encrypted_contact_references(principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,status)
   select principal_id,contact_ciphertext,repeat('e',64),key_revision,authority_revision,status
   from public.encrypted_contact_references where principal_id=recipient and status='current';
 end if;
 return pg_temp.request('a');
end $$;
select throws_ok($$select pg_temp.bad_contact('missing')$$,'55000','account_notice_binding_unavailable',
 'a missing mandatory contact refuses the actual request');
select throws_ok($$select pg_temp.bad_contact('stale')$$,'55000','account_notice_binding_unavailable',
 'a stale authority contact refuses the actual request');
select throws_ok($$select pg_temp.bad_contact('ambiguous')$$,'55000','account_notice_binding_unavailable',
 'two current contacts refuse rather than selecting the newest');
select is((select count(*) from public.account_deletion_requests),0::bigint,'contact refusals create no deletion row');
select is((select count(*) from public.account_operation_nonces where nonce_hash=repeat('a',64)),0::bigint,
 'contact refusals roll back the rendered operation nonce');
select ok((select deletion_requested_at is null from public.profiles where id='7a000000-0000-0000-0000-000000000001'),
 'contact refusals create no account hold');

create function pg_temp.fail_notice() returns trigger language plpgsql as $$
begin
 if new.template_id like 'account-deletion-affected%' then
  raise exception using errcode='P0001',message='synthetic notice failure'; end if;
 return new;
end $$;
create trigger synthetic_notice_failure before insert on public.mail_outbox for each row execute function pg_temp.fail_notice();
select throws_ok($$select pg_temp.request('a')$$,'P0001','synthetic notice failure',
 'a mandatory outbox failure rolls back the actual request');
select is((select count(*) from public.account_deletion_requests),0::bigint,'outbox failure creates no deletion row');
select is((select count(*) from public.account_operation_nonces where nonce_hash=repeat('a',64)),0::bigint,
 'outbox failure creates no spent nonce');
select is((select count(*) from public.mail_outbox where template_id in('account-deletion-notice','account-deletion-affected')),
 0::bigint,'even the already-inserted holder notice is rolled back');
drop trigger synthetic_notice_failure on public.mail_outbox;

create temporary table deletion as select pg_temp.request('a') id;
select isnt((select id from deletion),null,'the real owned-cohort request commits with all mandatory notices');
select is((select count(*) from public.mail_outbox where target_id=(select id from deletion)
 and template_id='account-deletion-affected'),(select count(*) from recipients),'exactly one notice is queued per resolved principal');
select is((select count(*) from public.mail_outbox where target_id=(select id from deletion)
 and template_id='account-deletion-notice'),1::bigint,'the holder receives its separate holder-only notice');
select ok(not exists(select 1 from public.mail_outbox m join public.account_deletion_requests d on d.id=m.target_id
 where d.id=(select id from deletion) and m.template_id='account-deletion-affected'
 and (m.template_payload<>jsonb_build_object('noticeEndsAt',d.notice_ends_at)
  or m.token_purpose is not null or m.token_target_id is not null)),
 'affected notices contain only the original deadline and no token or holder links');
create temporary table original_phase as select p.* from public.retention_due_phases p
 where p.immutable_envelope->>'deletionRequestId'=(select id::text from deletion);
select is((select immutable_envelope->'affectedNotice'->>'version' from original_phase),'account-affected-notice-v1',
 'the exact notice binding is saved in the original phase');
select lives_ok($$select private.assert_account_affected_notice_receipt_v1((select id from deletion),
 (select immutable_envelope from original_phase))$$,'the actual saved notice envelope satisfies the due boundary');
select throws_ok($$select private.assert_account_affected_notice_receipt_v1((select id from deletion),
 (select immutable_envelope-'affectedNotice' from original_phase))$$,'55000','account_notice_binding_unavailable',
 'a legacy unnotified request cannot cross the due boundary');
select throws_ok($$select private.assert_account_affected_notice_receipt_v1((select id from deletion),
 jsonb_set((select immutable_envelope from original_phase),'{affectedNotice,recipients,0,contactId}',to_jsonb(gen_random_uuid())))$$,
 '55000','account_notice_binding_unavailable','a crossed saved contact tuple cannot authorize due deletion');
select throws_ok($$select pg_temp.request('b')$$,'23505','deletion_request_exists','a second active request refuses');
select is((select count(*) from public.mail_outbox where target_id=(select id from deletion)
 and template_id='account-deletion-affected'),(select count(*) from recipients),'a refused second request duplicates no affected mail');
select is((select count(*) from public.claim_due_account_deletion_v1(repeat('d',64))),0::bigint,
 'the original account phase remains unclaimable before its seven-day deadline');

create function pg_temp.cancel() returns text language sql as $$
 select status from public.cancel_account_deletion_v2(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 repeat('c',64),clock_timestamp()+interval '9 minutes',repeat('f',64));
$$;
create trigger synthetic_notice_failure before insert on public.mail_outbox for each row execute function pg_temp.fail_notice();
select throws_ok($$select pg_temp.cancel()$$,'P0001','synthetic notice failure',
 'a cancellation outbox failure rolls back cancellation');
select is((select state from public.account_deletion_requests where id=(select id from deletion)),'notice_period',
 'failed cancellation preserves the active request');
select is((select count(*) from auth.sessions where user_id='7a000000-0000-0000-0000-000000000001'),1::bigint,
 'failed cancellation preserves the original current session');
select is((select count(*) from public.account_operation_nonces where nonce_hash=repeat('c',64)),0::bigint,
 'failed cancellation rolls back its nonce');
drop trigger synthetic_notice_failure on public.mail_outbox;

-- An independently ended resource must never be restored by cancellation.
select lives_ok($$select public.restrict_embryo_cohort_v1(
 '7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1',
 (select cohort_id from live),'nonce-account-notice-restrict-aaaaaaaa')$$,
 'the other parent independently withdraws during the notice window');
create temporary table ended_resources as select id,status,lifecycle_revision from public.embryo_cohorts where id=(select cohort_id from live);
create temporary table ended_grants as select grant_id,revoked_at,revocation_reason from public.purpose_grants
 where target_kind='cohort' and target_id=(select cohort_id from live);
select is(pg_temp.cancel(),'active','the actual cancellation commits before account purge begins');
select is((select count(*) from public.mail_outbox where target_id=(select id from deletion)
 and template_id='account-deletion-affected-cancelled'),(select count(*) from recipients),
 'exactly one cancellation notice is queued per applicable original principal');
select ok(not exists(select 1 from public.mail_outbox m join public.account_deletion_requests d on d.id=m.target_id
 where d.id=(select id from deletion) and m.template_id='account-deletion-affected-cancelled'
 and (m.template_payload<>jsonb_build_object('cancelledAt',d.cancelled_at) or m.token_purpose is not null or m.token_target_id is not null)),
 'cancellation mail contains only its committed event time');
select is((select to_jsonb(c) from(select id,status,lifecycle_revision from public.embryo_cohorts where id=(select cohort_id from live))c),
 (select to_jsonb(c) from ended_resources c),'cancellation preserves the independently restricted cohort byte for byte');
select is((select jsonb_agg(to_jsonb(g) order by grant_id) from(select grant_id,revoked_at,revocation_reason from public.purpose_grants
 where target_kind='cohort' and target_id=(select cohort_id from live))g),
 (select jsonb_agg(to_jsonb(g) order by grant_id) from ended_grants g),'cancellation restores no independently ended consent');
select is((select count(*) from auth.sessions where user_id='7a000000-0000-0000-0000-000000000001'),0::bigint,
 'cancellation revokes every old holder session');
select is((select phase_deadline from public.retention_due_phases where retention_row_id=(select retention_row_id from original_phase)
 and phase_id='account-deletion-notice-deadline'),(select phase_deadline from original_phase),
 'cancellation never shifts the original fixed phase deadline');
select is((select status from public.retention_due_phases where retention_row_id=(select retention_row_id from original_phase)
 and phase_id='account-deletion-notice-deadline'),'cancelled','the original unstarted account phase is cancelled');
select is((select count(*) from public.mail_provider_attempts a join public.mail_outbox m on m.id=a.outbox_id
 where m.target_id=(select id from deletion)),0::bigint,'notice proof makes no provider submissions');
select * from finish();
rollback;
