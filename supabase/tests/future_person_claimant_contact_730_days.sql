-- The claimant's temporary contact class future-person.claimed-unbound-24mo is
-- exactly 730 days (20261016175000_future_person_claimant_contact_730_days.sql;
-- G5.4; owner decision 2026-10-16 "Claimant retention stated in days").
--
-- Proves, on synthetic rows only, that a release writes every part of the
-- contact clock at the release plus exactly 730 days, that the Recovery Key
-- receipt reports that day, that the purge refuses one second early and
-- completes at the deadline, and that neither patched function keeps the
-- 24-month interval or gains a privilege. The purge is driven through its
-- existing private test clock; no deadline is moved. Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/future_person_custody_source.inc
\ir fixtures/future_person_custody_approved.inc

select is(private.future_person_claimed_unbound_days_v1(),730,'the class is exactly 730 days');
select private.detach_future_person_subject_v1((select review from custody_ids));
create temporary table release_window as select clock_timestamp() before_at;
select private.queue_future_person_release_v1((select review from custody_ids),
 '7e175000-0000-4000-8000-000000000001',extensions.gen_random_bytes(128),jsonb_build_object('1',pg_temp.h('contact-730')));
create temporary table contact_clock as select t.id,t.fixed_deadline,t.state,p.phase_deadline,p.status,p.immutable_envelope,c.created_at
 from public.retention_rows t join public.retention_due_phases p on p.retention_row_id=t.id
 join public.encrypted_contact_references c on c.id=(p.immutable_envelope->>'contactReferenceId')::uuid
 where t.retention_id='future-person.claimed-unbound-24mo' and t.target_id=(select claimant from custody_ids);
select is((select count(*) from contact_clock),1::bigint,'the release writes exactly one contact clock');
select ok((select fixed_deadline=created_at+interval '730 days' and extract(epoch from fixed_deadline-created_at)=730*86400
 and created_at>=(select before_at from release_window) from contact_clock),
 'its fixed deadline is the release time plus exactly 730 days');
select ok((select phase_deadline=fixed_deadline and status='pending' and state='scheduled' from contact_clock),
 'its one due phase has the same deadline');
select is((select count(*) from public.contact_hmac_indexes i
 where i.contact_reference_id=((select immutable_envelope from contact_clock)->>'contactReferenceId')::uuid
  and i.expires_at is distinct from (select fixed_deadline from contact_clock)),0::bigint,
 'every contact lookup index expires at the same 730-day deadline');
select ok((select cp.contact_expires_at=(select fixed_deadline from contact_clock) from public.future_person_claimant_principals cp
 where cp.id=(select claimant from custody_ids)),'the claimant''s contact expiry is the same 730-day deadline');
select ok((select o.expires_at=least((select created_at from contact_clock)+interval '7 days',(select fixed_deadline from contact_clock))
 from public.mail_outbox o where o.id=((select immutable_envelope from contact_clock)->>'outboxId')::uuid),
 'the release mail keeps its own 7-day delivery window inside the contact clock');

-- The Recovery Key receipt reports the contact day the page states.
create function pg_temp.claim_release() returns text language plpgsql as $$
declare r record;n integer;
begin for n in 1..30 loop
 select * into r from public.claim_mail_outbox();
 if r.outbox_id is null then return null;end if;
 if r.outbox_id=((select immutable_envelope from contact_clock)->>'outboxId')::uuid then return r.delivery_token;end if;
 end loop;return null;end $$;
create temporary table delivery as select pg_temp.claim_release() token;
select ok((select token~'^[A-Za-z0-9_-]{43}$' from delivery),'the release mail issues the real hash-only token');
select public.activate_rights_session_v1(encode(extensions.digest(convert_to((select token from delivery),'UTF8'),'sha256'),'hex'),
 pg_temp.h('contact-730-rights'),'contact-730-activation-nonce-aaaa');
select is(public.issue_future_person_recovery_key_v1(pg_temp.h('contact-730-rights'),'contact-730-recovery-nonce-aaaa',
  pg_temp.h('contact-730-recovery')),
 (select ((fixed_deadline at time zone 'UTC')::date) from contact_clock),
 'the Recovery Key receipt reports the day 730 days after the release');

-- The purge: never early, and complete at the deadline.
select throws_ok($$select private.purge_future_person_contact_phase_v1((select id from contact_clock),
  (select fixed_deadline-interval '1 second' from contact_clock))$$,
 '55000','claimant contact purge binding unavailable','the contact is never purged before its 730 days');
select ok(private.purge_future_person_contact_phase_v1((select id from contact_clock),(select fixed_deadline from contact_clock)),
 'the contact is purged at exactly its 730-day deadline');
set constraints all immediate;
select ok((select t.state='complete' and p.status='succeeded' and t.fixed_deadline=(select fixed_deadline from contact_clock)
 from public.retention_rows t join public.retention_due_phases p on p.retention_row_id=t.id
 where t.id=(select id from contact_clock)),'the clock completes without its deadline changing');
select is(public.future_person_rights_view_v1(pg_temp.h('contact-730-rights')),null::jsonb,
 'the expired contact cannot reopen the claimant page');

-- Exactly the two reviewed bodies changed, with no new privilege.
select is((select count(*) from pg_proc where oid in ('private.queue_future_person_release_v1(uuid,uuid,bytea,jsonb)'::regprocedure,
  'private.purge_future_person_contact_phase_v1(uuid,timestamptz)'::regprocedure)
  and prosrc like '%private.future_person_claimed_unbound_days_v1()%' and prosrc not like '%24 months%'),2::bigint,
 'both functions use the 730-day constant and neither keeps the 24-month interval');
select is((select string_agg(md5(prosrc),',' order by proname) from pg_proc where oid in
  ('private.queue_future_person_release_v1(uuid,uuid,bytea,jsonb)'::regprocedure,
   'private.purge_future_person_contact_phase_v1(uuid,timestamptz)'::regprocedure)),
 '3ead230272e5cba98bbd45075a3a3bbd,4bf007b76ff40b3f55247b91e05f4343','both bodies are exactly the reviewed successors');
select ok(not has_function_privilege('service_role','private.queue_future_person_release_v1(uuid,uuid,bytea,jsonb)','execute')
 and not has_function_privilege('service_role','private.purge_future_person_contact_phase_v1(uuid,timestamptz)','execute')
 and not has_function_privilege('service_role','private.future_person_claimed_unbound_days_v1()','execute')
 and not has_function_privilege('authenticated','private.future_person_claimed_unbound_days_v1()','execute'),
 'no API role can call the release writer, the private purge clock or the constant');
select * from finish();
rollback;
