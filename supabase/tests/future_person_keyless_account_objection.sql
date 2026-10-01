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
-- This independent account path never activates or borrows the owner link.
create temporary table own_notice as select id,notice_revision from public.future_person_claim_notices;
grant select on own_notice to authenticated,service_role;
create temporary table account_read_before as select
  (select count(*) from public.embryo_operation_nonces) nonces,
  (select count(*) from public.rights_sessions) sessions,
  (select coalesce(jsonb_agg(to_jsonb(existing_session) order by existing_session.id),'[]'::jsonb)
    from public.rights_sessions existing_session) session_rows,
  (select count(*) from public.token_candidates) candidates,
  (select count(*) from public.future_person_claims) claims;
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select throws_ok($$select public.future_person_owner_objection_controls_v1(null)$$,'42501','claim notice unavailable',
  'missing own Auth cannot enumerate current-owner notices');
select throws_ok($$select public.future_person_owner_account_objection_scope_v1((select id from own_notice))$$,
  '42501','claim notice unavailable','missing own Auth cannot select statement encryption scope');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub','7a000000-0000-0000-0000-000000000002',
  'role','authenticated','session_id','7a000000-0000-4000-8000-0000000000b1','aal','aal2',
  'iss','http://127.0.0.1:54321/auth/v1','aud','authenticated','exp',extract(epoch from clock_timestamp())::bigint+3600)::text,true);
set local role authenticated;
select is(public.future_person_owner_objection_controls_v1(null),'{"items":[],"nextCursor":null}'::jsonb,
  'a non-owner evidenced parent has no owner-notice projection');
select throws_ok($$select public.future_person_owner_account_objection_scope_v1((select id from own_notice))$$,
  '42501','claim notice unavailable','another current parent cannot borrow the owner account action');
select throws_ok($$select public.submit_future_person_account_objection_v1((select id from own_notice),2,
  'account-owner-objection-0001',extensions.gen_random_bytes(128),extensions.gen_random_bytes(72))$$,
  '42501','claim notice unavailable','another current parent has zero mutation effect');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub','7a000000-0000-0000-0000-000000000001',
  'role','authenticated','session_id','7a000000-0000-4000-8000-0000000000a1','aal','aal2',
  'iss','http://127.0.0.1:54321/auth/v1','aud','authenticated','exp',extract(epoch from clock_timestamp())::bigint+3600,
  'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from clock_timestamp())::bigint-60)))::text,true);
-- Scoped exception blocks roll back each synthetic Auth perturbation while
-- the TAP counters remain outside them. Neither failed probe can retain it.
create function pg_temp.account_auth_refusal(p_factor boolean) returns text language plpgsql as $$
begin
  begin
    if p_factor then
      insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
        values(gen_random_uuid(),'7a000000-0000-0000-0000-000000000001','Synthetic owner factor','totp','verified',
          'synthetic-secret',clock_timestamp(),clock_timestamp());
      update auth.sessions set aal='aal1' where id='7a000000-0000-4000-8000-0000000000a1';
    else
      update auth.sessions set created_at=clock_timestamp()-interval '16 minutes'
        where id='7a000000-0000-4000-8000-0000000000a1';
    end if;
    perform public.future_person_owner_account_objection_scope_v1((select id from own_notice));
    raise exception 'synthetic refusal missing';
  exception when others then return sqlstate||':'||sqlerrm;end;
end $$;
select is(pg_temp.account_auth_refusal(false),'42501:recent_reauthentication_required',
  'current ownership cannot substitute for fresh own authentication');
select is(pg_temp.account_auth_refusal(true),'42501:mfa_required',
  'a configured factor cannot be downgraded by a matching owner identity');
create temporary table own_account_controls(body jsonb);
grant select,insert on own_account_controls to authenticated;
set local role authenticated;
insert into own_account_controls select public.future_person_owner_objection_controls_v1(null);
select is(jsonb_array_length((select body->'items' from own_account_controls)),1,
  'own fresh Auth discovers exactly its current delivered owner notice');
select is(public.future_person_owner_objection_controls_v1(null),(select body from own_account_controls),
  'repeated settings reads preserve every database authority and clock');
select is((select array_agg(key order by key collate "C") from jsonb_object_keys(
  (select body#>'{items,0}' from own_account_controls))key),
  array['allowedActionIds','noticeDeadline','noticeId','noticeRevision','objectionArtifactBody','safeNoticeSummary'],
  'the server-only selector has the exact closed scope and no claimant/source/contact');
select is(public.future_person_owner_objection_controls_v1((select id from own_notice)),
  '{"items":[],"nextCursor":null}'::jsonb,'the exact current cursor cannot repeat a notice');
select is((public.future_person_owner_account_objection_scope_v1((select id from own_notice))->>'noticeId'),
  (select id::text from own_notice),'the own-JWT scope binds only the exact current notice');
select throws_ok($$select public.submit_future_person_account_objection_v1((select id from own_notice),3,
  'account-owner-objection-0001',extensions.gen_random_bytes(128),extensions.gen_random_bytes(72))$$,
  '42501','claim notice unavailable','stale notice revision cannot consume or object');
reset role;
select ok((select nonces=(select count(*) from public.embryo_operation_nonces)
  and sessions=(select count(*) from public.rights_sessions)
  and candidates=(select count(*) from public.token_candidates)
  and claims=(select count(*) from public.future_person_claims) from account_read_before),
  'stateless account discovery and all refused writes create no nonce, session, candidate or claim');
set local role authenticated;
select is(public.submit_future_person_account_objection_v1((select id from own_notice),2,
  'account-owner-objection-0001',extensions.gen_random_bytes(128),extensions.gen_random_bytes(72)),
  '{"status":"suspended_for_review"}'::jsonb,'the real independent account action atomically commits the closed202 receipt');
select throws_ok($$select public.submit_future_person_account_objection_v1((select id from own_notice),2,
  'account-owner-objection-0001',extensions.gen_random_bytes(128),extensions.gen_random_bytes(72))$$,
  '42501','claim notice unavailable','the spent owner revision cannot replay after acceptance');
select is(public.future_person_owner_objection_controls_v1(null),'{"items":[],"nextCursor":null}'::jsonb,
  'the committed objection removes only that notice from the current owner action inventory');
reset role;
select is((select count(*) from public.future_person_claim_objections),1::bigint,'only one exact notice-bound objection is committed');
select ok((select status='submitted' and objection_revision=1 and notice_id=(select id from own_notice)
  and initial_notice_revision=2 and timely_deadline=least(submitted_at+interval '30 days',
    (select created_at+interval '92 days' from private.claim_reviews))
  and octet_length(wrapped_statement_key)=72 and statement_key_shredded_at is null
  from public.future_person_claim_objections),'the account action uses the same immutable bounded claim-only freeze');
select ok((select status='current' and review_operation='claim-objection' and assignment_revision=2
  from private.claim_review_assignments where status='current'),'the actual action issues a new named operation assignment');
select is((select coalesce(jsonb_agg(to_jsonb(current_session) order by current_session.id),'[]'::jsonb)
  from public.rights_sessions current_session),(select session_rows from account_read_before),
  'account-equivalent authority preserves the exact complete pre-existing session set without borrowing or issuing one');
select is((select count(*) from public.rights_sessions where purpose='future-person-claim-objection'
  and target_id=(select id from own_notice)),0::bigint,
  'account-equivalent authority creates no owner-notice link session');
select is((select count(*) from public.future_person_claimant_principals),0::bigint,'the objection creates no approved claimant');
select is((select count(*) from private.future_person_custody_slices),0::bigint,'the objection detaches no source');
select ok((select subject=(select to_jsonb(s) from public.subjects s where id=(select subject from keyless_ids))
  and embryo=(select to_jsonb(e) from public.embryos e where id=(select embryo from keyless_ids))
  and profile=(select to_jsonb(fi) from public.future_person_identity fi where id=(select profile from keyless_ids))
  and files=(select jsonb_agg(to_jsonb(f) order by id) from public.genome_files f where subject_id=(select subject from keyless_ids))
  and sources=(select jsonb_agg(to_jsonb(cs) order by file_id) from private.embryo_canonical_sources cs)
  and parts=(select jsonb_agg(to_jsonb(cp) order by id) from private.embryo_canonical_parts cp)
  and cards=(select jsonb_agg(to_jsonb(k) order by key_revision) from public.future_person_record_key_hashes k)
  from notice_preserved),'the account objection preserves exact subject, record, profile, source, parts, files and Card');
select ok(not has_function_privilege('service_role','public.submit_future_person_account_objection_v1(uuid,bigint,text,bytea,bytea)','EXECUTE')
  and not has_function_privilege('anon','public.submit_future_person_account_objection_v1(uuid,bigint,text,bytea,bytea)','EXECUTE')
  and not has_function_privilege('inherit_upload_only','public.submit_future_person_account_objection_v1(uuid,bigint,text,bytea,bytea)','EXECUTE'),
  'only authenticated own-JWT execution can reach the equivalent account door');
select ok(not has_function_privilege('authenticated','private.record_keyless_owner_objection_v1(uuid,bigint,bytea,bytea)','EXECUTE')
  and not has_function_privilege('service_role','private.record_keyless_owner_objection_v1(uuid,bigint,bytea,bytea)','EXECUTE'),
  'the shared mutation cannot supply actor authority when called directly by any API');
set constraints all immediate;
select * from finish();
rollback;
