begin;
select no_plan();
-- One delayed transaction and the actual co-parent invitation/acceptance
-- doors. No provider is contacted, and the rollback restores all state.
create temporary table queue_clock as select clock_timestamp() before_fixture;
select pg_sleep(0.02);
\ir fixtures/embryo_cohort_pre_finalize.inc
create temporary table original_invitation_mail as select m.* from public.mail_outbox m
 where m.idempotency_key=repeat('1',64) and m.template_id='co-parent-invitation';
select is((select count(*) from original_invitation_mail),1::bigint,'the actual invitation queues exactly one mail');
select ok((select created_at>f.before_fixture from original_invitation_mail m cross join queue_clock f),
 'queue creation follows the delayed transaction start');
select is((select created_at from original_invitation_mail),(select not_before from original_invitation_mail),
 'one captured creation instant also sets initial availability');
select is((select expires_at from original_invitation_mail),(select fixed_expires_at from public.embryo_cohort_drafts
 where id=(select draft_id from draft)),'the exact original draft deadline is preserved');
select ok((select expires_at>created_at and expires_at<=created_at+interval '30 days' from original_invitation_mail),
 'the actual invitation stays inside both strict retention boundaries');
create temporary table replayed_invitation as
select * from public.create_embryo_draft_invitation_v1(
 '7a000000-0000-0000-0000-000000000001',
 '7a000000-0000-4000-8000-0000000000a1', (select draft_id from draft),
 repeat('b',64),repeat('1',64),'nonce-invite-clock-replay-aaaaaaaa',true,
 p_quota_keys=>pg_temp.invitation_quota_keys());
select is((select invitation_id from replayed_invitation),(select invitation_id from inv),
 'the actual invitation replay returns the original invitation');
select is((select expires_at from replayed_invitation),(select expires_at from original_invitation_mail),
 'the actual invitation replay retains its fixed deadline');
select is((select to_jsonb(m) from public.mail_outbox m where id=(select id from original_invitation_mail)),
 (select to_jsonb(m) from original_invitation_mail m),
 'the actual invitation replay leaves every outbox field unchanged');
-- A real helper call must not rely on transaction-start column defaults.
-- Altering defaults here is a rollback-only compatibility probe, not a
-- production migration or a relaxed constraint.
alter table public.mail_outbox alter column created_at set default now(), alter column not_before set default now();
create temporary table exact_deadline as select clock_timestamp()+interval '30 days' expiry;
create temporary table exact_queue as select private.enqueue_embryo_principal_mail_v1(
 (select recipient_principal_id from original_invitation_mail),'co-parent-invitation','co-parent-invitation',
 'subject_invitation',(select target_id from original_invitation_mail),'{}',repeat('a',64),
 (select expiry from exact_deadline),null,null) id;
select isnt((select id from exact_queue),null,'the real queue producer works under transaction-start defaults');
select is((select expires_at from public.mail_outbox where id=(select id from exact_queue)),(select expiry from exact_deadline),
 'the explicit boundary deadline is stored byte-identically, never clamped');
select ok((select created_at>now() and created_at=not_before from public.mail_outbox where id=(select id from exact_queue)),
 'the producer supplies a current coherent creation instant instead of the older defaults');
create temporary table original_exact_queue as select m.* from public.mail_outbox m
 where id=(select id from exact_queue);
select is(private.enqueue_embryo_principal_mail_v1((select recipient_principal_id from original_invitation_mail),
 'co-parent-invitation','co-parent-invitation','subject_invitation',(select target_id from original_invitation_mail),
 '{}',repeat('a',64),(select expiry from exact_deadline)+interval '1 day',null,null),(select id from exact_queue),
 'replay returns the original outbox identity');
select is((select to_jsonb(m) from public.mail_outbox m where id=(select id from exact_queue)),
 (select to_jsonb(m) from original_exact_queue m),
 'the original row is retained on replay');
select is((select expires_at from public.mail_outbox where id=(select id from exact_queue)),(select expiry from exact_deadline),
 'replay cannot renew the original deadline');
-- Pin the table CHECK itself at one exact captured instant. Clone only the
-- synthetic metadata shape, never create a capability or provider attempt.
create function pg_temp.boundary(p_delta interval) returns uuid language plpgsql as $$
declare t timestamptz:=clock_timestamp(); result uuid;
begin
 insert into public.mail_outbox
 select (jsonb_populate_record(null::public.mail_outbox,to_jsonb(m)||jsonb_build_object(
  'id',gen_random_uuid(),'idempotency_key',encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),
  'created_at',t,'not_before',t,'expires_at',t+interval '30 days'+p_delta,'token_purpose',null,'token_target_id',null))).*
 from original_invitation_mail m returning id into result;
 return result;
end $$;
create temporary table boundary_row as select pg_temp.boundary(interval '0') id;
select ok((select expires_at=created_at+interval '30 days' from public.mail_outbox where id=(select id from boundary_row)),
 'exact thirty-day equality is accepted');
select throws_ok($$select pg_temp.boundary(interval '1 microsecond')$$,'23514',null,
 'one microsecond beyond the strict cap is refused');
select throws_ok($$select pg_temp.boundary(interval '-30 days')$$,'23514',null,
 'expiry equal to creation is refused');
select throws_ok($$select pg_temp.boundary(interval '-30 days -1 microsecond')$$,'23514',null,
 'expiry before creation is refused');
select throws_ok($$select private.enqueue_embryo_principal_mail_v1((select recipient_principal_id from original_invitation_mail),
 'co-parent-invitation','co-parent-invitation','subject_invitation',(select target_id from original_invitation_mail),
 '{}',repeat('b',64),clock_timestamp()+interval '31 days',null,null)$$,'23514',null,
 'the actual producer cannot adjust creation to admit an overlong explicit expiry');
select is((select count(*) from public.mail_outbox where idempotency_key=repeat('b',64)),0::bigint,
 'a refused overlong queue creates no outbox row');
select throws_ok($$select private.enqueue_embryo_principal_mail_v1((select recipient_principal_id from original_invitation_mail),
 'co-parent-invitation','co-parent-invitation','subject_invitation',(select target_id from original_invitation_mail),
 '{}',repeat('c',64),clock_timestamp()-interval '1 second',null,null)$$,'23514',null,
 'the actual producer refuses an already expired explicit deadline');
select is((select count(*) from public.mail_outbox where idempotency_key=repeat('c',64)),0::bigint,
 'a refused expired queue creates no outbox row');
select is((select count(*) from public.mail_provider_attempts where outbox_id in(select id from exact_queue
 union all select id from boundary_row)),0::bigint,'clock verification makes no provider submission');
select * from finish();
rollback;
