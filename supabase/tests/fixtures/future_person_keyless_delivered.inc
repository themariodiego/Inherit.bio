-- Real synthetic publication/transfer/profile/document/reviewer producers.
-- Synthetic encrypted/provider/chunk metadata below tests SQL authority and
-- clocks only; it is not actual documentary human, byte delivery or Resend
-- delivery credit. The public positive/release/objection workflow stays shut.
\ir future_person_keyless_documents.inc

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
