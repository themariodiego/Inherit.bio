begin;
select plan(21);
\ir fixtures/rights_invitation_pending.inc
grant select on delivery,inv,draft,tok to service_role;
select ok(public.authorize_mail_submission_v1((select outbox_id from delivery),
 (select attempt_ordinal from delivery)),'the current issued invitation is eligible at the provider checkpoint');
select public.activate_rights_session_v1((select hash from tok),repeat('c',64),'public-form-aaaaaaaaaaaaaaaa');
select is(public.read_co_parent_refusal_v1(repeat('c',64)),'ready','a current session has an accountless refusal action');
select ok(not public.authorize_mail_submission_v1((select outbox_id from delivery),
 (select attempt_ordinal from delivery)),'a consumed mailed credential is not submitted again');
set local role service_role;
select lives_ok($$select public.refuse_co_parent_invitation_session_v1(
 repeat('c',64),'public-refuse-aaaaaaaaaaaaaaaa')$$,'the service facade commits accountless refusal');
select is(public.read_co_parent_refusal_v1(repeat('c',64)),'done','a completed session has only a generic receipt');
select throws_ok($$update public.embryo_operation_nonces set rights_session_hash=null
 where rights_session_hash=repeat('c',64)$$,'23514',null,
 'a refusal receipt cannot keep a deadline without its session hash');
select throws_ok($$update public.embryo_operation_nonces set rights_receipt_expires_at=null
 where rights_session_hash=repeat('c',64)$$,'23514',null,
 'a refusal receipt cannot keep its session hash without a deadline');
select ok(not public.authorize_mail_submission_v1((select outbox_id from delivery),
 (select attempt_ordinal from delivery)),'refusal cancels a claimed invitation before provider submission');
create temporary table cleanup as select * from public.claim_refused_invitation_draft_purge_v1(repeat('a',64));
select lives_ok($$select public.finish_refused_invitation_draft_purge_v1(
 (select manifest_id from cleanup),repeat('a',64))$$,'the exact draft cleanup executes');
select is((select count(*) from public.rights_sessions where session_hash=repeat('c',64)),0::bigint,
 'cleanup removes the old session');
select lives_ok($$select public.refuse_co_parent_invitation_session_v1(
 repeat('c',64),'public-refuse-aaaaaaaaaaaaaaaa')$$,'the same refusal retry succeeds after physical draft/session deletion');
select is(public.read_co_parent_refusal_v1(repeat('c',64)),'done','page reload after cleanup still shows the generic receipt');
select throws_ok($$select public.refuse_co_parent_invitation_session_v1(
 repeat('d',64),'public-refuse-aaaaaaaaaaaaaaaa')$$,'42501','rights session unavailable',
 'a refusal receipt cannot be used by a different session');
select throws_ok($$select public.refuse_co_parent_invitation_session_v1(
 repeat('c',64),'different-refuse-aaaaaaaaaaaaa')$$,'42501','rights session unavailable',
 'a receipt does not grant new operations after session deletion');
select ok((select rights_receipt_expires_at<=consumed_at+interval '24 hours'
 and account_id is null and session_id is null from public.embryo_operation_nonces
 where rights_session_hash=repeat('c',64)),'the receipt has only the bounded hash binding and operation metadata');
reset role;
select is((select count(*) from private.invitation_terminal_notices
 where invitation_id=(select invitation_id from inv)),2::bigint,'retry does not duplicate terminal notices');
update public.embryo_operation_nonces set consumed_at=clock_timestamp()-interval '25 hours',
 rights_receipt_expires_at=clock_timestamp()-interval '2 hours' where rights_session_hash=repeat('c',64);
set local role service_role;
select is(public.read_co_parent_refusal_v1(repeat('c',64)),null::text,'an expired receipt grants no display authority');
select is(public.expire_invitation_refusal_receipts_v1(),1,'the independent retention job deletes the expired receipt');
select is((select count(*) from public.embryo_operation_nonces where rights_session_hash=repeat('c',64)),0::bigint,
 'no expired rights-session hash remains');
reset role;
select ok(not has_function_privilege('anon','public.refuse_co_parent_invitation_session_v1(text,text)','execute')
 and not has_function_privilege('authenticated','public.read_co_parent_refusal_v1(text)','execute'),
 'API roles cannot bypass the server form and cookie checks');
select * from finish();
rollback;
