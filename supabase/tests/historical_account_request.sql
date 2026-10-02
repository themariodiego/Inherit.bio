begin;
select no_plan();
-- Owner-only SQL executor fixture. Synthetic Auth metadata and nonce hashes
-- prove database rules only, never SDK authentication, MAC verification,
-- native HTTP202 acceptance, notice passage or physical-provider deletion.
\ir fixtures/future_person_custody_source.inc

create temporary table historical_account_clock as
 select clock_timestamp() before_at,null::timestamptz after_at,null::timestamptz effective_at;
create function pg_temp.historical_request(p_hash text,p_effective timestamptz,p_session uuid default '7a000000-0000-4000-8000-0000000000a1',
 p_expiry timestamptz default null) returns uuid language sql as $$
 select r.deletion_id from private.request_account_deletion_at_v1(
  '7a000000-0000-0000-0000-000000000001',p_session,p_hash,
  coalesce(p_expiry,clock_timestamp()+interval '9 minutes'),decode('0011223344556677','hex'),repeat('2',64),
  encode(extensions.digest('historical-holder:'||p_hash,'sha256'),'hex'),p_effective) r;
$$;
select is((select count(*) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) api
 cross join unnest(array['private.request_account_deletion_clock_core_v1(uuid,uuid,text,bytea,text,text,timestamptz)',
 'private.enqueue_account_affected_notice_clock_core_v1(uuid,jsonb,boolean,timestamptz,timestamptz)',
 'private.request_account_deletion_at_v1(uuid,uuid,text,timestamptz,bytea,text,text,timestamptz)']) door
 where has_function_privilege(api,door,'execute')),0::bigint,'all four API roles lack every historical entry and internal core');

-- The upload-only role intentionally has no USAGE on the pgTAP schema.
-- Execute the unchanged denial queries as their real API roles; only the TAP
-- comparison runs as the owner. No grant or SECURITY DEFINER helper is added.
create function pg_temp.historical_denied(p_role text,p_query text) returns jsonb
language plpgsql security invoker as $$
declare observed_role text; observed_state text:='accepted'; observed_message text;
begin
 if current_user<>'postgres' or p_role not in('anon','authenticated','inherit_upload_only','service_role') then
  raise exception using errcode='42501',message='synthetic denial probe owner only';end if;
 begin
  execute format('set local role %I',p_role);
  observed_role:=current_user;
  begin
   execute p_query;
  exception when others then observed_state:=sqlstate;observed_message:=sqlerrm;
  end;
  raise exception using errcode='ZY001',message='restore synthetic denial probe';
 exception when sqlstate 'ZY001' then null;
 end;
 return jsonb_build_object('role',observed_role,'state',observed_state,'message',observed_message);
end $$;
select is(pg_temp.historical_denied('anon',$denied$select * from private.request_account_deletion_at_v1(null,null,null,null,null,null,null,clock_timestamp())$denied$),
 jsonb_build_object('role','anon','state','42501','message','permission denied for schema private'),
 'anon cannot use an owner historical clock or its NULL core under the exact requested API role');
select is(pg_temp.historical_denied('anon',$denied$select * from private.request_account_deletion_clock_core_v1(null,null,null,null,null,null,null)$denied$),
 jsonb_build_object('role','anon','state','42501','message','permission denied for schema private'),
 'anon cannot use an owner historical clock or its NULL core under the exact requested API role');
select is(pg_temp.historical_denied('anon',$denied$select * from private.enqueue_account_affected_notice_clock_core_v1(null,null,false,null,null)$denied$),
 jsonb_build_object('role','anon','state','42501','message','permission denied for schema private'),
 'anon cannot use an owner historical clock or its NULL core under the exact requested API role');
select is(pg_temp.historical_denied('authenticated',$denied$select * from private.request_account_deletion_at_v1(null,null,null,null,null,null,null,clock_timestamp())$denied$),
 jsonb_build_object('role','authenticated','state','42501','message','permission denied for function request_account_deletion_at_v1'),
 'authenticated cannot use an owner historical clock or its NULL core under the exact requested API role');
select is(pg_temp.historical_denied('authenticated',$denied$select * from private.request_account_deletion_clock_core_v1(null,null,null,null,null,null,null)$denied$),
 jsonb_build_object('role','authenticated','state','42501','message','permission denied for function request_account_deletion_clock_core_v1'),
 'authenticated cannot use an owner historical clock or its NULL core under the exact requested API role');
select is(pg_temp.historical_denied('authenticated',$denied$select * from private.enqueue_account_affected_notice_clock_core_v1(null,null,false,null,null)$denied$),
 jsonb_build_object('role','authenticated','state','42501','message','permission denied for function enqueue_account_affected_notice_clock_core_v1'),
 'authenticated cannot use an owner historical clock or its NULL core under the exact requested API role');
select is(pg_temp.historical_denied('inherit_upload_only',$denied$select * from private.request_account_deletion_at_v1(null,null,null,null,null,null,null,clock_timestamp())$denied$),
 jsonb_build_object('role','inherit_upload_only','state','42501','message','permission denied for function request_account_deletion_at_v1'),
 'inherit_upload_only cannot use an owner historical clock or its NULL core under the exact requested API role');
select is(pg_temp.historical_denied('inherit_upload_only',$denied$select * from private.request_account_deletion_clock_core_v1(null,null,null,null,null,null,null)$denied$),
 jsonb_build_object('role','inherit_upload_only','state','42501','message','permission denied for function request_account_deletion_clock_core_v1'),
 'inherit_upload_only cannot use an owner historical clock or its NULL core under the exact requested API role');
select is(pg_temp.historical_denied('inherit_upload_only',$denied$select * from private.enqueue_account_affected_notice_clock_core_v1(null,null,false,null,null)$denied$),
 jsonb_build_object('role','inherit_upload_only','state','42501','message','permission denied for function enqueue_account_affected_notice_clock_core_v1'),
 'inherit_upload_only cannot use an owner historical clock or its NULL core under the exact requested API role');
select is(pg_temp.historical_denied('service_role',$denied$select * from private.request_account_deletion_at_v1(null,null,null,null,null,null,null,clock_timestamp())$denied$),
 jsonb_build_object('role','service_role','state','42501','message','permission denied for function request_account_deletion_at_v1'),
 'service_role cannot use an owner historical clock or its NULL core under the exact requested API role');
select is(pg_temp.historical_denied('service_role',$denied$select * from private.request_account_deletion_clock_core_v1(null,null,null,null,null,null,null)$denied$),
 jsonb_build_object('role','service_role','state','42501','message','permission denied for function request_account_deletion_clock_core_v1'),
 'service_role cannot use an owner historical clock or its NULL core under the exact requested API role');
select is(pg_temp.historical_denied('service_role',$denied$select * from private.enqueue_account_affected_notice_clock_core_v1(null,null,false,null,null)$denied$),
 jsonb_build_object('role','service_role','state','42501','message','permission denied for function enqueue_account_affected_notice_clock_core_v1'),
 'service_role cannot use an owner historical clock or its NULL core under the exact requested API role');
select throws_ok($$select pg_temp.historical_request(repeat('a',64),null)$$,'22023','invalid historical account clock',
 'the explicit owner finite_at entry refuses NULL');
select throws_ok($$select pg_temp.historical_request(repeat('a',64),'infinity')$$,'22023','invalid historical account clock',
 'positive infinity cannot create a request');
select throws_ok($$select pg_temp.historical_request(repeat('a',64),'-infinity')$$,'22023','invalid historical account clock',
 'negative infinity cannot create a request');
select throws_ok($$select pg_temp.historical_request(repeat('a',64),clock_timestamp()+interval '1 hour')$$,
 '22023','invalid historical account clock','a future effective request refuses rather than clamping');
select is((select count(*) from public.account_operation_nonces),0::bigint,'clock refusals record no operation nonce');
select is((select count(*) from public.account_deletion_requests),0::bigint,'clock refusals create no hold or immutable request');

-- The unchanged real-time API producer remains a separate current proof.
update historical_account_clock set before_at=clock_timestamp();
create temporary table ordinary_account_request as select r.* from public.request_account_deletion_v2(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',repeat('a',64),
 clock_timestamp()+interval '9 minutes',decode('0011223344556677','hex'),repeat('2',64),repeat('b',64)) r;
update historical_account_clock set after_at=clock_timestamp();
select is((select status from ordinary_account_request),'notice_period','ordinary v2 still creates the original notice state');
select ok((select d.requested_at between t.before_at and t.after_at and d.created_at between d.requested_at and t.after_at
 and d.notice_ends_at=d.requested_at+interval '7 days' from public.account_deletion_requests d
 cross join historical_account_clock t where d.id=(select deletion_id from ordinary_account_request)),
 'ordinary NULL core preserves real request capture and actual default recording time');
select ok(not exists(select 1 from public.mail_outbox m cross join historical_account_clock t
 where m.target_id=(select deletion_id from ordinary_account_request)
 and (m.created_at not between t.before_at and t.after_at or m.not_before not between t.before_at and t.after_at)),
 'ordinary direct defaults and affected-notice declaration remain actual current clocks');
select is((select count(*) from public.claim_due_account_deletion_v1(repeat('d',64))),0::bigint,
 'unchanged public due consumer refuses the newly current seven-day request');
select lives_ok($$select private.assert_account_affected_notice_receipt_v1((select deletion_id from ordinary_account_request),
 (select immutable_envelope from public.retention_due_phases where immutable_envelope->>'deletionRequestId'=
 (select deletion_id::text from ordinary_account_request)))$$,'ordinary original notice envelope remains genuine');
select throws_ok($$select pg_temp.historical_request(repeat('a',64),clock_timestamp()-interval '7 days 10 minutes')$$,
 '22023','invalid_operation_nonce','a native current request nonce cannot be borrowed by the historical entry');
select is((select count(*) from public.account_deletion_requests),1::bigint,'borrowed nonce creates no second row');
select lives_ok($$select * from public.cancel_account_deletion_v2(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',repeat('c',64),
 clock_timestamp()+interval '9 minutes',repeat('e',64))$$,'genuine current cancellation ends the separate ordinary request');
create temporary table original_current_rows as select jsonb_build_object('request',to_jsonb(d),
 'phase',(select to_jsonb(f) from public.retention_due_phases f where f.immutable_envelope->>'deletionRequestId'=d.id::text),
 'mail',(select jsonb_agg(to_jsonb(m) order by m.id) from public.mail_outbox m where m.target_id=d.id)) value
 from public.account_deletion_requests d where d.id=(select deletion_id from ordinary_account_request);

-- Actual cancellation revoked every old owner session. Start a distinct new
-- current synthetic SQL session; this is not SDK reauthentication evidence.
select is((select count(*) from auth.sessions where id='7a000000-0000-4000-8000-0000000000a1'),0::bigint,
 'genuine current cancellation revokes the original owner session before a new operation');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values(
 '7a000000-0000-4000-8000-0000000000a3','7a000000-0000-0000-0000-000000000001',
 clock_timestamp(),clock_timestamp(),'aal1');
select ok((select user_id='7a000000-0000-0000-0000-000000000001'::uuid
 and created_at>=(select after_at from historical_account_clock) and created_at<=clock_timestamp()
 from auth.sessions where id='7a000000-0000-4000-8000-0000000000a3'),
 'the distinct post-cancellation SQL session belongs to the owner and records actual current creation');
create or replace function pg_temp.historical_request(p_hash text,p_effective timestamptz,p_session uuid default '7a000000-0000-4000-8000-0000000000a3',
 p_expiry timestamptz default null) returns uuid language sql as $$
 select r.deletion_id from private.request_account_deletion_at_v1(
  '7a000000-0000-0000-0000-000000000001',p_session,p_hash,
  coalesce(p_expiry,clock_timestamp()+interval '9 minutes'),decode('0011223344556677','hex'),repeat('2',64),
  encode(extensions.digest('historical-holder:'||p_hash,'sha256'),'hex'),p_effective) r;
$$;
create function pg_temp.stale_historical_session() returns uuid language plpgsql as $$
begin
 update auth.sessions set created_at=clock_timestamp()-interval '16 minutes'
 where id='7a000000-0000-4000-8000-0000000000a3';
 if not found then raise exception using errcode='P0001',message='synthetic current session missing';end if;
 return pg_temp.historical_request(repeat('f',64),clock_timestamp()-interval '7 days 10 minutes');
end $$;
select throws_ok($$select pg_temp.stale_historical_session()$$,'42501','recent_reauthentication_required',
 'historical effective time cannot turn a stale actual session into current authority');
create function pg_temp.historical_without_current_mfa() returns uuid language plpgsql as $$
begin
 insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
 values(gen_random_uuid(),'7a000000-0000-0000-0000-000000000001','Synthetic historical refusal','totp','verified',
 'synthetic-secret',clock_timestamp(),clock_timestamp());
 update auth.sessions set aal='aal1' where id='7a000000-0000-4000-8000-0000000000a3';
 if not found then raise exception using errcode='P0001',message='synthetic current session missing';end if;
 return pg_temp.historical_request(repeat('f',64),clock_timestamp()-interval '7 days 10 minutes');
end $$;
select throws_ok($$select pg_temp.historical_without_current_mfa()$$,'42501','mfa_required',
 'effective history cannot replace the existing verified-factor actual MFA requirement');
select throws_ok($$select pg_temp.historical_request(repeat('f',64),clock_timestamp()-interval '7 days 10 minutes',
 '7a000000-0000-4000-8000-0000000000b1')$$,'42501','recent_reauthentication_required',
 'the counterpart actual session cannot authorize the owner historical request');
select throws_ok($$select pg_temp.historical_request(repeat('f',64),clock_timestamp()-interval '7 days 10 minutes',
 '7a000000-0000-4000-8000-0000000000a3',clock_timestamp()-interval '1 minute')$$,
 '22023','invalid_operation_nonce','historical business time cannot revive a nonce expired on the real clock');
select throws_ok($$select pg_temp.historical_request(repeat('f',64),clock_timestamp()-interval '7 days 10 minutes',
 '7a000000-0000-4000-8000-0000000000a3',clock_timestamp()+interval '11 minutes')$$,
 '22023','invalid_operation_nonce','historical creation retains the actual ten-minute nonce expiry ceiling');
create function pg_temp.bad_historical_contact() returns uuid language plpgsql as $$
begin
 update public.encrypted_contact_references set authority_revision=authority_revision+1 where principal_id=any(
 private.embryo_cohort_set_v1((select cohort_id from live),'notice_recipients')) and status='current';
 return pg_temp.historical_request(repeat('f',64),clock_timestamp()-interval '7 days 10 minutes');
end $$;
select throws_ok($$select pg_temp.bad_historical_contact()$$,'55000','account_notice_binding_unavailable',
 'historical creation requires each actual current recipient/contact revision');
select is((select count(*) from public.account_operation_nonces where nonce_hash=repeat('f',64)),0::bigint,
 'current authority failures roll back their one-time nonce records');
select is((select count(*) from public.account_deletion_requests where state='notice_period'),0::bigint,
 'current authority failures add no historical request');

-- A failing real affected-notice INSERT must unwind every preceding write.
-- This test-local trigger produces a refusal; it never inserts a fake notice.
create function pg_temp.refuse_historical_affected_notice() returns trigger language plpgsql as $$
begin
 if new.template_id='account-deletion-affected' then
  raise exception using errcode='P0001',message='synthetic affected notice refused';end if;
 return new;
end $$;
create trigger historical_affected_notice_refusal before insert on public.mail_outbox
 for each row execute function pg_temp.refuse_historical_affected_notice();
create temporary table before_historical_refusal as select jsonb_build_object(
 'request',(select jsonb_agg(to_jsonb(d) order by d.id) from public.account_deletion_requests d),
 'phase',(select jsonb_agg(to_jsonb(f) order by f.retention_row_id,f.phase_id,f.phase_revision) from public.retention_due_phases f),
 'manifest',(select jsonb_agg(to_jsonb(m) order by m.id) from public.purge_manifests m),
 'retention',(select jsonb_agg(to_jsonb(r) order by r.id) from public.retention_rows r),
 'mail',(select jsonb_agg(to_jsonb(m) order by m.id) from public.mail_outbox m),
 'profile',(select to_jsonb(p) from public.profiles p where p.id='7a000000-0000-0000-0000-000000000001'),
 'contacts',(select jsonb_agg(to_jsonb(e) order by e.id) from public.encrypted_contact_references e),
 'indexes',(select jsonb_agg(to_jsonb(i) order by i.contact_reference_id,i.hmac_key_revision) from public.contact_hmac_indexes i),
 'nonces',(select jsonb_agg(to_jsonb(n) order by n.nonce_hash) from public.account_operation_nonces n)) value;
select throws_ok($$select pg_temp.historical_request(repeat('f',64),clock_timestamp()-interval '7 days 10 minutes')$$,
 'P0001','synthetic affected notice refused','missing actual notice creation cannot leave a partial historical envelope');
select is(jsonb_build_object(
 'request',(select jsonb_agg(to_jsonb(d) order by d.id) from public.account_deletion_requests d),
 'phase',(select jsonb_agg(to_jsonb(f) order by f.retention_row_id,f.phase_id,f.phase_revision) from public.retention_due_phases f),
 'manifest',(select jsonb_agg(to_jsonb(m) order by m.id) from public.purge_manifests m),
 'retention',(select jsonb_agg(to_jsonb(r) order by r.id) from public.retention_rows r),
 'mail',(select jsonb_agg(to_jsonb(m) order by m.id) from public.mail_outbox m),
 'profile',(select to_jsonb(p) from public.profiles p where p.id='7a000000-0000-0000-0000-000000000001'),
 'contacts',(select jsonb_agg(to_jsonb(e) order by e.id) from public.encrypted_contact_references e),
 'indexes',(select jsonb_agg(to_jsonb(i) order by i.contact_reference_id,i.hmac_key_revision) from public.contact_hmac_indexes i),
 'nonces',(select jsonb_agg(to_jsonb(n) order by n.nonce_hash) from public.account_operation_nonces n)),
 (select value from before_historical_refusal),'notice failure rolls back full nonce/profile/contact/request/retention/manifest/mail state');
drop trigger historical_affected_notice_refusal on public.mail_outbox;

update historical_account_clock set before_at=clock_timestamp(),effective_at=clock_timestamp()-interval '7 days 10 minutes';
create temporary table historical_request as select pg_temp.historical_request(repeat('f',64),
 (select effective_at from historical_account_clock)) id;
update historical_account_clock set after_at=clock_timestamp();
select ok((select d.requested_at=t.effective_at and d.notice_ends_at=d.requested_at+interval '7 days'
 and d.created_at between t.before_at and t.after_at and d.created_at>d.notice_ends_at
 from public.account_deletion_requests d cross join historical_account_clock t where d.id=(select id from historical_request)),
 'synthetic effective history and actual row recording time are explicit at creation');
select ok((select r.created_at between t.before_at and t.after_at and m.created_at between t.before_at and t.after_at
 and r.created_at>d.notice_ends_at and m.created_at>d.notice_ends_at
 from public.account_deletion_requests d cross join historical_account_clock t
 join public.retention_due_phases f on f.immutable_envelope->>'deletionRequestId'=d.id::text
 join public.retention_rows r on r.id=f.retention_row_id
 join public.purge_manifests m on m.retention_row_id=r.id and m.phase_id=f.phase_id and m.phase_revision=f.phase_revision
 where d.id=(select id from historical_request)),
 'actual retention and manifest recording defaults distinguish synthetic effective history');
select ok((select n.issued_at between t.before_at and t.after_at and n.consumed_at between n.issued_at and t.after_at
 and n.expires_at>t.after_at from public.account_operation_nonces n cross join historical_account_clock t
 where n.nonce_hash=repeat('f',64) and n.operation='account_delete' and n.session_id='7a000000-0000-4000-8000-0000000000a3'),
 'the freshly verified nonce is recorded and consumed on actual time, never the synthetic business clock');
select ok((select deletion_requested_at between t.before_at and t.after_at from public.profiles p
 cross join historical_account_clock t where p.id='7a000000-0000-0000-0000-000000000001'),
 'the current profile hold records an actual operation, not an old Auth event');
select ok(not exists(select 1 from public.mail_outbox m join public.account_deletion_requests d on d.id=m.target_id
 where d.id=(select id from historical_request) and (m.created_at<>d.requested_at or m.not_before<>d.requested_at
 or m.expires_at<>d.notice_ends_at+interval '1 day' or m.expires_at<=m.created_at
 or m.expires_at>m.created_at+interval '30 days')),
 'every historical holder/affected notice starts with one exact effective creation/expiry anchor');
select is((select count(*) from public.mail_outbox m where m.target_id=(select id from historical_request)
 and m.template_id='account-deletion-affected'),
 (select cardinality(private.embryo_cohort_set_v1((select cohort_id from live),'notice_recipients')))::bigint,
 'historical creation still issues exactly one notice for every genuine current recipient');
select ok(not exists(select 1 from public.mail_outbox m join public.account_deletion_requests d on d.id=m.target_id
 where d.id=(select id from historical_request) and m.template_id='account-deletion-affected'
 and (m.template_payload<>jsonb_build_object('noticeEndsAt',d.notice_ends_at)
 or m.token_purpose is not null or m.token_target_id is not null)),
 'historical affected notice has the exact immutable deadline and no holder link or token');
create temporary table historical_phase_before as select f.* from public.retention_due_phases f
 where f.immutable_envelope->>'deletionRequestId'=(select id::text from historical_request);
select ok((select r.fixed_deadline=d.notice_ends_at and f.phase_deadline=d.notice_ends_at
 and (f.immutable_envelope->>'originalNoticeEndsAt')::timestamptz=d.notice_ends_at
 and f.immutable_envelope->'affectedNotice'->>'version'='account-affected-notice-v1'
 from public.account_deletion_requests d join historical_phase_before f on f.immutable_envelope->>'deletionRequestId'=d.id::text
 join public.retention_rows r on r.id=f.retention_row_id where d.id=(select id from historical_request)),
 'the complete immutable phase/envelope is created with the same original effective deadline');
select ok((select m.source_binding_fingerprint=encode(extensions.digest(concat_ws(':','account-deletion-v1',d.id::text,
 d.account_id::text,d.principal_graph_revision::text,d.notice_ends_at::text),'sha256'),'hex')
 from public.purge_manifests m join historical_phase_before f on f.retention_row_id=m.retention_row_id
 join public.account_deletion_requests d on d.id=(f.immutable_envelope->>'deletionRequestId')::uuid),
 'the original actual manifest algorithm binds the new request/current graph/effective deadline');
select lives_ok($$select private.assert_account_affected_notice_receipt_v1((select id from historical_request),
 (select immutable_envelope from historical_phase_before))$$,'the actual unchanged due-boundary notice verifier accepts the complete receipt');
select throws_ok($$select private.assert_account_affected_notice_receipt_v1((select id from historical_request),
 jsonb_set((select immutable_envelope from historical_phase_before),'{affectedNotice,recipients,0,contactId}',to_jsonb(gen_random_uuid())))$$,
 '55000','account_notice_binding_unavailable','a forged saved contact cannot borrow a historical due phase');
select throws_ok($$select pg_temp.historical_request(repeat('f',64),(select effective_at from historical_account_clock))$$,
 '22023','invalid_operation_nonce','the owner historical entry consumes its actual nonce once');
select is((select jsonb_build_object('request',to_jsonb(d),
 'phase',(select to_jsonb(f) from public.retention_due_phases f where f.immutable_envelope->>'deletionRequestId'=d.id::text),
 'mail',(select jsonb_agg(to_jsonb(m) order by m.id) from public.mail_outbox m where m.target_id=d.id))
 from public.account_deletion_requests d where d.id=(select deletion_id from ordinary_account_request)),
 (select value from original_current_rows),'historical creation never ages or rewrites the separate genuine current request/notice/envelope');
-- The actual unchanged consumer evaluates real due time, makes one queue claim
-- and runs the original graph planner. No state/lease/provider row is planted.
create temporary table genuinely_due as select r.* from public.claim_due_account_deletion_v1(repeat('d',64),300) r;
select is((select count(*) from genuinely_due),1::bigint,'the unchanged queue genuinely claims exactly one synthetic due request');
select is((select deletion_id from genuinely_due),(select id from historical_request),'the actual due selection is the exact newly produced request');
select is((select immutable_envelope from public.retention_due_phases where immutable_envelope->>'deletionRequestId'=
 (select id::text from historical_request)),(select immutable_envelope from historical_phase_before),
 'actual due claiming preserves the exact original immutable envelope');
select ok((select count(*)=2 and bool_and(coalesce(proconfig@>array['lock_timeout=250ms'],false)) from pg_proc
 where oid in('private.prepare_future_person_deletion_v1(text,text)'::regprocedure,
 'private.finish_future_person_deletion_v1(uuid,text)'::regprocedure)),
 'both original claimant lock ceilings stay exactly250ms');
set constraints all immediate;
select pass('all actual FK and deferred authority constraints resolve before rollback');
select * from finish();
rollback;
