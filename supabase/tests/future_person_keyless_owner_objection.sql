begin;
select no_plan();
-- Real synthetic publication/transfer/profile/document/reviewer producers.
-- Synthetic encrypted/provider/chunk metadata below tests SQL authority and
-- clocks only; it is not actual documentary human, byte delivery or Resend
-- delivery credit. The public positive/release/objection workflow stays shut.
\ir fixtures/future_person_keyless_documents.inc

insert into public.encrypted_contact_references(principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,status)
  select id,extensions.gen_random_bytes(64),pg_temp.keyless_hash('owner-contact'),1,principal_revision,'current'
  from public.subject_principals where account_id='7a000000-0000-0000-0000-000000000001'
    and principal_kind='account_subject' and status='active';
create temporary table notice_input as select gen_random_uuid() contact_id,
  (pg_temp.keyless_lookup()#>>'{scope,comparisonReceiptDigest}') receipt;
create temporary table notice_preserved as select
  (select to_jsonb(s) from public.subjects s where id=(select subject from keyless_ids)) subject,
  (select to_jsonb(e) from public.embryos e where id=(select embryo from keyless_ids)) embryo,
  (select to_jsonb(fi) from public.future_person_identity fi where id=(select profile from keyless_ids)) profile,
  (select jsonb_agg(to_jsonb(f) order by id) from public.genome_files f where subject_id=(select subject from keyless_ids)) files,
  (select jsonb_agg(to_jsonb(cs) order by file_id) from private.embryo_canonical_sources cs) sources,
  (select jsonb_agg(to_jsonb(cp) order by id) from private.embryo_canonical_parts cp) parts,
  (select jsonb_agg(to_jsonb(k) order by key_revision) from public.future_person_record_key_hashes k) cards;
create function pg_temp.prepare_notice(p_nonce text default 'notice-determination',p_receipt text default null,p_parent boolean default true)
returns jsonb language sql as $$
  select private.prepare_keyless_owner_notice_v1((select review from keyless_ids),1,pg_temp.keyless_hash(p_nonce),
    extensions.gen_random_bytes(64),extensions.gen_random_bytes(64),
    ((clock_timestamp() at time zone 'UTC')::date-interval '19 years')::date,p_parent,
    jsonb_build_object('1',repeat('a',64)),jsonb_build_object('1',repeat('b',64)),
    coalesce(p_receipt,(select receipt from notice_input)),extensions.gen_random_bytes(128),extensions.gen_random_bytes(72),
    (select contact_id from notice_input),extensions.gen_random_bytes(128),jsonb_build_object('1',repeat('c',64)));
$$;
select is(pg_temp.prepare_notice()->>'state','approved_pending_owner_notice',
  'actual documentary determination commits the minimum and exact current-owner queue');
-- Actual current canonical service doors; only synthetic provider/clock
-- metadata is used. No raw token is returned or persisted by this fixture.
create function pg_temp.claim_notice_metadata() returns jsonb language plpgsql as $$
declare claimed_mail record;
begin
  select * into claimed_mail from public.claim_mail_outbox();
  if claimed_mail.outbox_id is null or claimed_mail.template_id<>'future-person-owner-notice'
    or claimed_mail.delivery_token is null or claimed_mail.delivery_token!~'^[A-Za-z0-9_-]{43}$' then
    raise exception 'synthetic current owner notice was not claimed with a valid credential';end if;
  return jsonb_build_object('outbox',claimed_mail.outbox_id,'ordinal',claimed_mail.attempt_ordinal,
    'providerKey',claimed_mail.idempotency_key,'tokenHash',encode(extensions.digest(convert_to(claimed_mail.delivery_token,'UTF8'),'sha256'),'hex'));
end $$;
create temporary table provider_input(first jsonb);
grant select,insert on provider_input to service_role;
grant select on keyless_ids,notice_input to service_role;
set local role service_role;
insert into provider_input select pg_temp.claim_notice_metadata();
select is(public.authorize_mail_submission_v1((select (first->>'outbox')::uuid from provider_input),1::smallint),true,
  'real service role can authorize only its exact current first notice attempt');
select is(public.authorize_mail_submission_v1((select (first->>'outbox')::uuid from provider_input),2::smallint),false,
  'a different attempt cannot authorize the same first token');
select public.complete_mail_attempt((select (first->>'outbox')::uuid from provider_input),1::smallint,false,null,'synthetic_provider_failure');
reset role;
select ok((select n.delivered_at is null and n.notice_deadline is null and k.state='open'
  from public.future_person_claim_notices n join public.future_person_claim_review_packages k on k.claim_id=n.claim_id),
  'retryable provider failure neither starts the period nor approves or closes a current claim');
select is((select private.mail_provider_attempt_key_v1(m) from public.mail_outbox m where id=(select (first->>'outbox')::uuid from provider_input)),
  (select first->>'providerKey' from provider_input),'re-reading one exact attempt retains its provider key');
-- Only advance synthetic queue eligibility, not any immutable claim or notice
-- clock. This rehearses the provider backoff seam without elapsed-time credit.
update public.mail_outbox set not_before=clock_timestamp() where id=(select (first->>'outbox')::uuid from provider_input);
create temporary table successor_input(second jsonb);
grant select,insert on successor_input to service_role;
set local role service_role;
insert into successor_input select pg_temp.claim_notice_metadata();
reset role;
select is((select (second->>'ordinal')::integer from successor_input),2,'the actual canonical retry creates the next attempt');
select isnt((select second->>'providerKey' from successor_input),(select first->>'providerKey' from provider_input),
  'a regenerated credential uses a different provider key for its exact submission attempt');
select isnt((select second->>'tokenHash' from successor_input),(select first->>'tokenHash' from provider_input),
  'retry rotates the raw credential and its stored hash');
select ok((select h.status='revoked' and h.ended_at is not null from public.token_hashes h
  where h.token_hash=(select first->>'tokenHash' from provider_input)),'retry atomically revokes the previous delivery hash');
select is((select count(*) from public.token_hashes h where h.candidate_id=(select candidate_id from public.future_person_claim_notices)
  and h.status='current'),1::bigint,'only the successor delivery hash is current');
set local role service_role;
select is(public.authorize_mail_submission_v1((select (first->>'outbox')::uuid from provider_input),1::smallint),false,
  'a canceled stale submission cannot authorize after rotation');
select throws_ok($$select public.complete_mail_attempt((select (first->>'outbox')::uuid from provider_input),1::smallint,true,
  pg_temp.keyless_hash('stale-acceptance'),'accepted')$$,'42501','claim notice unavailable',
  'stale provider acceptance cannot be attributed to a successor credential');
select is(public.authorize_mail_submission_v1((select (second->>'outbox')::uuid from successor_input),2::smallint),true,
  'only the successor current token and exact attempt can submit');
select public.complete_mail_attempt((select (second->>'outbox')::uuid from successor_input),2::smallint,true,
  pg_temp.keyless_hash('current-provider-message'),'accepted');
reset role;
select ok((select delivered_at is null and notice_deadline is null from public.future_person_claim_notices),
  'provider acceptance and elapsed queue eligibility still cannot issue notice time');
select is((select count(*) from public.retention_rows where retention_id='future-person.owner-notice-30d'),0::bigint,
  'no owner-period retention row exists before actual matched delivery');
-- A prior uncertain provider response is synthetic metadata only. It cannot
-- borrow the successor attempt's genuine current mail-delivery relation.
update public.mail_provider_attempts set provider_message_id_hmac=pg_temp.keyless_hash('old-uncertain-provider-message')
  where outbox_id=(select (first->>'outbox')::uuid from provider_input) and attempt_ordinal=1;
create temporary table before_stale_callback as select
  (select to_jsonb(n) from public.future_person_claim_notices n) notice,
  (select to_jsonb(d) from public.mail_deliveries d where outbox_id=(select (second->>'outbox')::uuid from successor_input)) delivery,
  (select to_jsonb(m) from public.mail_outbox m where id=(select (second->>'outbox')::uuid from successor_input)) outbox;
set local role service_role;
select is(public.record_resend_mail_event(pg_temp.keyless_hash('old-uncertain-provider-message'),pg_temp.keyless_hash('old-delivered'),
  'delivered',clock_timestamp()),false,'a superseded provider attempt cannot start the successor notice clock');
reset role;
select ok((select notice=(select to_jsonb(n) from public.future_person_claim_notices n)
  and delivery=(select to_jsonb(d) from public.mail_deliveries d where outbox_id=(select (second->>'outbox')::uuid from successor_input))
  and outbox=(select to_jsonb(m) from public.mail_outbox m where id=(select (second->>'outbox')::uuid from successor_input))
  from before_stale_callback),'the stale callback preserves exact notice, delivery and outbox rows');
set local role service_role;
select throws_ok($$select public.record_resend_mail_event(pg_temp.keyless_hash('current-provider-message'),null,
  'delivered',clock_timestamp())$$,'22023','invalid mail event','a current provider message cannot omit its event digest');
select throws_ok($$select public.record_resend_mail_event(pg_temp.keyless_hash('current-provider-message'),pg_temp.keyless_hash('bad-status'),
  null,clock_timestamp())$$,'22023','invalid mail event','NULL status cannot become delivered authority');
select throws_ok($$select public.record_resend_mail_event(pg_temp.keyless_hash('current-provider-message'),pg_temp.keyless_hash('bad-time'),
  'delivered','infinity'::timestamptz)$$,'22023','invalid mail event','an infinite provider timestamp cannot create a clock');
select is(public.record_resend_mail_event(pg_temp.keyless_hash('current-provider-message'),pg_temp.keyless_hash('current-delivered'),
  'delivered',clock_timestamp()),true,'the genuine canonical matched callback commits the owner clock atomically');
reset role;
select ok((select n.delivered_at is not null and n.notice_deadline=n.delivered_at+interval '30 days'
  and n.provider_attempt_id=a.id and a.attempt_ordinal=2 and d.provider_attempt_id=a.id and d.status='delivered'
  and n.notice_deadline=tc.expires_at from public.future_person_claim_notices n
  join public.mail_provider_attempts a on a.id=n.provider_attempt_id join public.mail_deliveries d on d.provider_attempt_id=a.id
  join public.token_candidates tc on tc.id=n.candidate_id),'full fixed30-day period and credential expiry bind only the exact delivered successor');
create temporary table committed_notice as select to_jsonb(n) body from public.future_person_claim_notices n;
set local role service_role;
select is(public.record_resend_mail_event(pg_temp.keyless_hash('current-provider-message'),pg_temp.keyless_hash('current-delivered-repeat'),
  'delivered',clock_timestamp()),true,'duplicate exact callback remains idempotent');
reset role;
select is((select to_jsonb(n) from public.future_person_claim_notices n),(select body from committed_notice),
  'duplicate delivery cannot renew the fixed start, deadline, owner or attempt');
select is((select count(*) from public.future_person_claimant_principals),0::bigint,'delivery creates no claimant principal');
select is((select count(*) from private.future_person_custody_slices),0::bigint,'delivery creates no detached custody');
select is((select count(*) from public.future_person_claims where status='approved'),0::bigint,'delivery cannot approve or release the claim');
-- The exact delivered synthetic provider attempt above supplies SQL receipt
-- authority only. It is not real provider, human, browser or byte-delivery credit.
create temporary table activated_owner_session as select null::text purpose,null::text target_kind,null::uuid target_id,null::timestamptz expires_at limit 0;
grant select,insert on activated_owner_session to service_role;
set local role service_role;
insert into activated_owner_session select * from public.activate_rights_session_v1(
  (select second->>'tokenHash' from successor_input),repeat('e',64),'owner-objection-activation-0001');
select is((select count(*) from activated_owner_session),1::bigint,'only the current issued delivered-owner credential creates a real rights session');
select is((select purpose from activated_owner_session),'future-person-claim-objection','the real issuer has its distinct owner-only purpose');
select is((select target_kind from activated_owner_session),'claim-notice','the session binds the exact server-stored owner notice');
select is((public.future_person_objection_view_v1(repeat('e',64))->'allowedActionIds')::text,'["object"]',
  'the actual owner view grants exactly the one registered objection action');
select is(public.future_person_objection_view_v1(repeat('f',64)),null::jsonb,'another session hash cannot read this notice');
reset role;
select ok((select s.expires_at=s.created_at+interval '60 minutes' and s.expires_at<=n.notice_deadline and s.last_activity_at=s.created_at
  from public.rights_sessions s join public.future_person_claim_notices n on n.id=s.target_id where s.session_hash=repeat('e',64)),
  'notice credentials keep30 days while the actual session is capped at60 minutes and its own idle clock');
select is((select array_agg(key order by key collate "C") from jsonb_object_keys(public.future_person_objection_view_v1(repeat('e',64))) key),
  array['allowedActionIds','noticeDeadline','objectionArtifactBody','safeNoticeSummary'],
  'the owner view has the exact closed four fields and no claimant, document or source');
select ok((private.keyless_owner_rights_session_at_v1(repeat('e',64),false,
  (select created_at+interval '14 minutes 59 seconds' from public.rights_sessions where session_hash=repeat('e',64)))).id is not null,
  'the owner-only trusted clock seam preserves a current session just before the15-minute idle boundary');
select ok((private.keyless_owner_rights_session_at_v1(repeat('e',64),false,
  (select created_at+interval '15 minutes' from public.rights_sessions where session_hash=repeat('e',64)))).id is null,
  'exactly15 idle minutes cannot authorize an objection');
select ok((private.keyless_owner_rights_session_at_v1(repeat('e',64),false,
  (select created_at+interval '60 minutes' from public.rights_sessions where session_hash=repeat('e',64)))).id is null,
  'exactly60 absolute minutes cannot borrow the longer notice period');
select throws_ok($$update public.rights_sessions set expires_at=expires_at+interval '1 second' where session_hash=repeat('e',64)$$,
  '42501','rights purpose unavailable','a live objection session cannot extend its immutable absolute expiry');
select throws_ok($$update public.rights_sessions set last_activity_at=last_activity_at+interval '1 second' where session_hash=repeat('e',64)$$,
  '42501','rights purpose unavailable','a caller cannot mint idle activity outside a real authorized mutation');
select throws_ok($$update public.rights_sessions set target_id=gen_random_uuid() where session_hash=repeat('e',64)$$,
  '42501','rights purpose unavailable','an issued session cannot be retargeted');
create temporary table objection_scope as select public.future_person_objection_statement_scope_v1(repeat('e',64)) body;
grant select on objection_scope to service_role;
create temporary table current_objection_id(id uuid);
grant select,insert on current_objection_id to authenticated;
set local role service_role;
select throws_ok($$select public.submit_future_person_owner_objection_v1(repeat('f',64),'owner-objection-submit-0001',
  (select (body->>'noticeId')::uuid from objection_scope),2,extensions.gen_random_bytes(128),extensions.gen_random_bytes(72))$$,
  '42501','claim notice unavailable','another cookie cannot submit to an owner-selected notice');
select throws_ok($$select public.submit_future_person_owner_objection_v1(repeat('e',64),'owner-objection-submit-0001',
  (select (body->>'noticeId')::uuid from objection_scope),3,extensions.gen_random_bytes(128),extensions.gen_random_bytes(72))$$,
  '42501','claim notice unavailable','a stale or invented notice revision has zero objection effect');
select is(public.submit_future_person_owner_objection_v1(repeat('e',64),'owner-objection-submit-0001',
  (select (body->>'noticeId')::uuid from objection_scope),2,extensions.gen_random_bytes(128),extensions.gen_random_bytes(72)),
  '{"status":"suspended_for_review"}'::jsonb,'the real owner-only POST atomically suspends this claim and returns only the closed receipt');
select is(public.future_person_objection_view_v1(repeat('e',64)),null::jsonb,'the spent notice session cannot be read after an objection');
select throws_ok($$select public.submit_future_person_owner_objection_v1(repeat('e',64),'owner-objection-submit-0001',
  (select (body->>'noticeId')::uuid from objection_scope),2,extensions.gen_random_bytes(128),extensions.gen_random_bytes(72))$$,
  '42501','claim notice unavailable','a replay cannot create another objection, assignment or clock');
reset role;
select ok((select o.status='submitted' and o.objection_revision=1 and o.timely_deadline=least(o.submitted_at+interval '30 days',r.created_at+interval '92 days')
  and octet_length(o.wrapped_statement_key)=72 and octet_length(o.statement_ciphertext)=128
  from public.future_person_claim_objections o join private.claim_reviews r on r.id=o.claim_id),
  'the encrypted statement and separately persisted timely-objection clock have the exact registered shape');
select ok((select status='cancelled' and terminal_outcome_code='timely_objection_transferred'
  from public.retention_due_phases where target_id=(select review from keyless_ids)
    and retention_id='future-person.keyless-notice-release-62d' and phase_id='keyless-day62-close'),
  'the original absolute phase is superseded only after its replacement is committed');
select ok((select p.status='pending' and p.phase_deadline=o.timely_deadline
  and p.immutable_envelope->>'objectionId'=o.id::text
  from public.retention_due_phases p join public.future_person_claim_objections o on o.claim_id=p.target_id
  where p.retention_id='future-person.claim-objection-review-30d' and p.phase_id='objection-review-decision-close'),
  'the one genuine replacement phase is tied to the exact objected claim');
select ok((select count(*)=1 and bool_and(review_operation='claim-objection' and assignment_revision=2)
  from private.claim_review_assignments where status='current'),'exactly one named operation-specific reviewer assignment replaces the documentary assignment');
select is((select count(*) from public.future_person_claimant_principals),0::bigint,'an objection creates no durable claimant authority');
select is((select count(*) from private.future_person_custody_slices),0::bigint,'an objection creates no detached custody');
select ok(private.claim_review_open_v1((select r from private.claim_reviews r where r.id=(select review from keyless_ids))),
  'only the two real immutable documents remain readable under the genuine objection retention clock');
insert into current_objection_id select id from public.future_person_claim_objections;
set local role authenticated;
select is(public.read_keyless_review_operation_v1((select id from current_objection_id),'claim-objection')->>'operation',
  'claim-objection','the actual current reviewer JWT can read only its current operation');
reset role;
select throws_ok($$select public.read_keyless_review_operation_v1((select review from keyless_ids),'claim-release')$$,
  '42501','claim review unavailable','an objection assignment cannot read or authorize a separate release operation');
select throws_ok($$select public.read_claim_review_case_v1((select review from keyless_ids))$$,
  '42501','claim review unavailable','the generic documentary view does not reopen erased intake identity');
select throws_ok($$update public.future_person_claim_objections set timely_deadline=timely_deadline+interval '1 second'$$,
  '55000','immutable claim objection','needs-more-information or reassignment cannot extend the immutable objection deadline');
select throws_ok($$update public.future_person_claim_objections set wrapped_statement_key=extensions.gen_random_bytes(72)$$,
  '55000','immutable claim objection','the sealed statement cannot be restored or rotated to a new key');
select private.close_keyless_notice_v1((select review from keyless_ids),'claim_deadline_expired');
select ok((select status='expired' and statement_ciphertext is null and wrapped_statement_key is null
  and statement_key_shredded_at is not null and review_reason_ciphertext is null from public.future_person_claim_objections),
  'claim-only deadline resolution atomically shreds every statement/basis key and retains only the coded outcome');
select ok((select count(*)=2 and bool_and(wrapped_document_key is null and document_key_shredded_at is not null)
  from private.claim_document_sessions where intake_id=(select review from keyless_ids)),
  'resolution destroys both independently wrapped document keys before Storage cleanup');
select ok((select subject=(select to_jsonb(s) from public.subjects s where id=(select subject from keyless_ids))
  and embryo=(select to_jsonb(e) from public.embryos e where id=(select embryo from keyless_ids))
  and profile=(select to_jsonb(fi) from public.future_person_identity fi where id=(select profile from keyless_ids))
  and files=(select jsonb_agg(to_jsonb(f) order by id) from public.genome_files f where subject_id=(select subject from keyless_ids))
  and sources=(select jsonb_agg(to_jsonb(cs) order by file_id) from private.embryo_canonical_sources cs)
  and parts=(select jsonb_agg(to_jsonb(cp) order by id) from private.embryo_canonical_parts cp)
  and cards=(select jsonb_agg(to_jsonb(k) order by key_revision) from public.future_person_record_key_hashes k)
  from notice_preserved),'objection and terminal closure preserve every original subject/profile/source/Card byte and later claimability');
select is((select count(*) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) role
  cross join unnest(array['private.keyless_owner_rights_session_at_v1(text,boolean,timestamp with time zone)',
    'private.keyless_owner_account_v1(uuid)','private.close_keyless_notice_before_objection_v1(uuid,text)',
    'public.activate_rights_session_before_keyless_objection_v1(text,text,text)']) fn where has_function_privilege(role,fn,'execute')),0::bigint,
  'no API role can call the trusted clock, account proof or predecessor aliases');
set constraints all immediate;
select * from finish();
rollback;
