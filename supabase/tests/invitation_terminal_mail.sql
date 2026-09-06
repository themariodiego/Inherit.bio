begin;
select plan(33);
\ir fixtures/rights_invitation_pending.inc
create temporary table notice_baseline as select count(*) n from private.invitation_terminal_notices;
update auth.users set email_confirmed_at=clock_timestamp()
where id='9a000000-0000-0000-0000-000000000001';
select is((select count(*) from public.activate_rights_session_v1(
 (select hash from tok),repeat('c',64),'notice-form-aaaaaaaaaaaaaaaa')),1::bigint,
 'the fixture activates the invitation');

-- Failure of the actual canonical outbox insert must roll back refusal.
create function pg_temp.fail_terminal_outbox() returns trigger language plpgsql as $$
begin
 if new.invitation_terminal_notice_id is not null then
  raise exception using errcode='ZY003',message='synthetic canonical outbox failure';
 end if;
 return new;
end;
$$;
create trigger synthetic_terminal_outbox_failure before insert on public.mail_outbox
for each row execute function pg_temp.fail_terminal_outbox();
select throws_ok($$select private.refuse_co_parent_invitation_v1(
 repeat('c',64),'notice-refusal-aaaaaaaaaaaaaaaa')$$,'ZY003','synthetic canonical outbox failure',
 'canonical outbox failure rolls back the refusal');
select is((select status from public.subject_invitations where id=(select invitation_id from inv)),
 'pending','outbox failure leaves the invitation pending');
select is((select count(*) from private.invitation_terminal_notices),(select n from notice_baseline),
 'outbox failure leaves no orphan recipient envelope');
drop trigger synthetic_terminal_outbox_failure on public.mail_outbox;
select lives_ok($$select private.refuse_co_parent_invitation_v1(
 repeat('c',64),'notice-refusal-aaaaaaaaaaaaaaaa')$$,'refusal enqueues both canonical notices atomically');
select is((select count(*) from public.mail_outbox m join private.invitation_terminal_notices n
 on n.id=m.invitation_terminal_notice_id where n.invitation_id=(select invitation_id from inv)),
 2::bigint,'both notice rows are in the canonical outbox');
select ok((select bool_and(m.state='queued' and m.expires_at=n.expires_at
 and m.recipient_principal_id is null and m.contact_reference_id is null
 and m.template_payload=jsonb_build_object('kind',n.notice_kind))
 from public.mail_outbox m join private.invitation_terminal_notices n on n.id=m.invitation_terminal_notice_id
 where n.invitation_id=(select invitation_id from inv)),
 'canonical notices carry only closed kind payloads and the original deadline');
select is((select count(*) from public.claim_mail_outbox()),0::bigint,
 'the ordinary worker leaves terminal recipient envelopes to their own guard');
select throws_ok($$insert into public.mail_outbox(
 template_id,purpose,target_kind,target_id,recipient_authority_revision,semantic_revision,idempotency_key,expires_at)
 values('ordinary','ordinary','subject_invitation',gen_random_uuid(),1,1,repeat('9',64),clock_timestamp()+interval '1 day')$$,
 '23514',null,'ordinary mail still requires principal and contact references');

-- Hold the owner row for a later authority-loss test, then deliver the contact.
update public.mail_outbox m set not_before=clock_timestamp()+interval '1 hour'
from private.invitation_terminal_notices n where m.invitation_terminal_notice_id=n.id and n.recipient_kind='account'
 and n.invitation_id=(select invitation_id from inv);
create temporary table first_claim as select * from public.claim_invitation_terminal_mail_v1();
select is((select count(*) from first_claim),1::bigint,'the terminal worker claims one due notice');
select ok((select contact_ciphertext is not null and recipient_account_id is null from first_claim),
 'the accountless recipient is resolved without an account lookup');
select is(public.authorize_invitation_terminal_mail_v1((select outbox_id from first_claim),99::smallint),
 false,'a stale attempt cannot submit');
select is(public.authorize_invitation_terminal_mail_v1(
 (select outbox_id from first_claim),(select attempt_ordinal from first_claim)),true,
 'current authority is rechecked immediately before provider submission');
select is(public.complete_invitation_terminal_mail_v1(
 (select outbox_id from first_claim),(select attempt_ordinal from first_claim),false,''),true,
 'a provider failure is recorded in the canonical attempt ledger');
update public.mail_outbox set not_before=clock_timestamp()-interval '1 second'
where id=(select outbox_id from first_claim);
create temporary table retry_claim as select * from public.claim_invitation_terminal_mail_v1();
select is((select idempotency_key from retry_claim),(select idempotency_key from first_claim),
 'retry keeps the original provider idempotency key');
select is((select attempt_ordinal from retry_claim),2::smallint,'retry advances the attempt ordinal');
select is(public.authorize_invitation_terminal_mail_v1(
 (select outbox_id from retry_claim),(select attempt_ordinal from retry_claim)),true,'the retry is reauthorized');
select is(public.complete_invitation_terminal_mail_v1(
 (select outbox_id from retry_claim),(select attempt_ordinal from retry_claim),true,repeat('a',64)),true,
 'provider acceptance is committed in the canonical delivery ledger');
select is((select count(*) from public.mail_deliveries where outbox_id=(select outbox_id from retry_claim)),
 1::bigint,'exactly one delivery receipt exists');
select ok((select n.contact_ciphertext is null and n.recipient_account_id is null and n.state='enqueued'
 from private.invitation_terminal_notices n join public.mail_outbox m on m.invitation_terminal_notice_id=n.id
 where m.id=(select outbox_id from retry_claim)),'accepted delivery immediately releases recipient data');
select is(public.complete_invitation_terminal_mail_v1(
 (select outbox_id from retry_claim),(select attempt_ordinal from retry_claim),true,repeat('a',64)),true,
 'the exact accepted completion can be retried');
select is(public.complete_invitation_terminal_mail_v1(
 (select outbox_id from retry_claim),(select attempt_ordinal from retry_claim),false,''),false,
 'a late failure cannot overwrite accepted delivery');

update public.mail_outbox m set not_before=clock_timestamp()-interval '1 second'
from private.invitation_terminal_notices n where m.invitation_terminal_notice_id=n.id and n.recipient_kind='account'
 and n.invitation_id=(select invitation_id from inv);
create temporary table owner_claim as select * from public.claim_invitation_terminal_mail_v1();
select is((select recipient_account_id from owner_claim),'9a000000-0000-0000-0000-000000000001'::uuid,
 'the owner notice returns only the server-selected account for verified address lookup');
update public.subject_principals set principal_revision=principal_revision+1
where account_id='9a000000-0000-0000-0000-000000000001' and principal_kind='account_subject';
select is(public.authorize_invitation_terminal_mail_v1(
 (select outbox_id from owner_claim),(select attempt_ordinal from owner_claim)),false,
 'changed owner authority blocks submission after claim');
select is((select count(*) from public.claim_invitation_terminal_mail_v1()),0::bigint,
 'a stale owner notice is not reclaimed');
select ok((select n.recipient_account_id is null and n.state='expired'
 from private.invitation_terminal_notices n join public.mail_outbox m on m.invitation_terminal_notice_id=n.id
 where m.id=(select outbox_id from owner_claim)),'stale recipient authority is released');

-- Fixed contact expiry removes canonical copies and receipts without waiting
-- for a provider, a source purge, or any real user action.
create temporary table ordinary_before as select count(*) n from public.mail_outbox where invitation_terminal_notice_id is null;
create temporary table expired_before as select count(*)::integer n
 from private.invitation_terminal_notices where expires_at<=clock_timestamp();
update private.invitation_terminal_notices
set created_at=created_at-interval '31 days',expires_at=expires_at-interval '31 days'
where invitation_id=(select invitation_id from inv);
update public.mail_outbox m set created_at=n.created_at,expires_at=n.expires_at
from private.invitation_terminal_notices n where m.invitation_terminal_notice_id=n.id
 and n.invitation_id=(select invitation_id from inv);
select is(public.expire_invitation_terminal_notices_v1(),2+(select n from expired_before),
 'fixed-deadline cleanup deletes both terminal recipient graphs plus already-due rows');
select is((select count(*) from private.invitation_terminal_notices
 where invitation_id=(select invitation_id from inv)),0::bigint,'no fixture terminal recipient envelope remains');
select is((select count(*) from public.mail_outbox where invitation_terminal_notice_id is not null
 and target_kind='subject_invitation' and target_id=(select invitation_id from inv)),0::bigint,
 'no terminal canonical outbox copy remains');
select is((select count(*) from public.mail_outbox where invitation_terminal_notice_id is null),(select n from ordinary_before),
 'expiry leaves unrelated ordinary mail unchanged');
select is(public.expire_invitation_terminal_notices_v1(),0,'expiry is idempotent');
select ok(not has_function_privilege('anon','public.claim_invitation_terminal_mail_v1()','execute')
 and not has_function_privilege('authenticated','public.claim_invitation_terminal_mail_v1()','execute')
 and not has_function_privilege('authenticated','public.expire_invitation_terminal_notices_v1()','execute'),
 'only the service worker can claim or expire recipient envelopes');
select * from finish();
rollback;
