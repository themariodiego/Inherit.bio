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
select throws_ok($$select pg_temp.prepare_notice(p_receipt=>repeat('d',64))$$,
  '42501','claim review unavailable','an invented receipt cannot bind a minimum package');
select throws_ok($$select pg_temp.prepare_notice(p_parent=>false)$$,
  '42501','claim review unavailable','profile equality cannot replace the explicit documentary parent-link attestation');
select is((select count(*) from public.future_person_claim_review_packages),0::bigint,'refusals create no package');
select is((select count(*) from public.future_person_claim_notices where notice_kind='owner_notice'),0::bigint,'refusals create no owner notice');
select is(pg_temp.prepare_notice()->>'state','approved_pending_owner_notice','the actual positive documentary transaction enters pending notice only');
select throws_ok($$select pg_temp.prepare_notice()$$,'42501','claim review unavailable','the positive documentary transaction is not repeatable');
select ok((select status='owner_notice' and decided_at is null and claim_method='keyless_documentary'
  from public.future_person_claims where id=(select review from keyless_ids)),'a pending claim is not final approval');
select ok((select state='approved_pending_owner_notice' and review_revision=2 and resolved_at is null
  and deadline=created_at+interval '30 days' from private.claim_reviews where id=(select review from keyless_ids)),
  'the original documentary deadline does not change');
select ok((select k.expires_at=r.created_at+interval '62 days' and k.delivery_deadline=k.documentary_at+interval '24 hours'
  and k.package_revision=2 and k.review_id=r.id and k.subject_id=(select subject from keyless_ids)
  from public.future_person_claim_review_packages k join private.claim_reviews r on r.id=k.review_id),
  'absolute maximum is original submission plus62 days; delivery has its own fixed24-hour deadline');
select ok((select octet_length(k.wrapped_comparison_key)=72 and octet_length(k.comparison_ciphertext)=128
  and k.comparison_key_shredded_at is null and k.state='open' from public.future_person_claim_review_packages k),
  'the bounded comparison has its own independently erasable wrapper');
select ok((select identity_key_shredded_at is not null and octet_length(identity_ciphertext)=29
  and octet_length(wrapped_data_key)=29 and key_hash is null from private.future_person_claim_intakes
  where id=(select review from keyless_ids)),'the original intake identity and key are erased immediately');
select ok((select count(*)=2 and bool_and(wrapped_document_key is not null and document_key_shredded_at is null)
  from private.claim_document_sessions where intake_id=(select review from keyless_ids)),
  'both immutable kind-specific independently wrapped document keys transfer');
select is((select count(*) from private.claim_documents d where d.intake_id=(select review from keyless_ids)
  and private.claim_document_retained_v1(d)),2::bigint,'only the two bound documents remain retained');
select is((select count(*) from public.future_person_claimant_principals),0::bigint,'pending notice creates no durable claimant authority');
select is((select count(*) from private.future_person_custody_slices),0::bigint,'pending notice creates no custody');
select is((select count(*) from public.future_person_claim_notices where owner_account_id='7a000000-0000-0000-0000-000000000001'),
  1::bigint,'the current owner receives one notice even when also a parent');
select is((select count(*) from public.future_person_claim_notices where owner_account_id='7a000000-0000-0000-0000-000000000002'),
  0::bigint,'a non-owner parent is never notified');
select is((select count(*) from public.retention_due_phases where target_id=(select review from keyless_ids)
  and retention_id='future-person.keyless-notice-release-62d' and status='pending'),2::bigint,
  'decision atomically commits both registered delivery and absolute-close phases');
select throws_ok($$update public.future_person_claim_review_packages set expires_at=expires_at+interval '1 second'$$,
  '55000','immutable claim review package','neither reassignment nor retry may extend the absolute deadline');
select throws_ok($$update public.future_person_claim_review_packages set wrapped_comparison_key=extensions.gen_random_bytes(72)$$,
  '55000','immutable claim review package','the package cannot be resealed under a successor key');
select throws_ok($$update public.future_person_claim_notices set owner_account_id='7a000000-0000-0000-0000-000000000002'$$,
  '55000','immutable owner notice','a caller cannot retarget notice to another parent');
select ok(private.keyless_owner_notice_current_v1((select review from keyless_ids)),'the exact actual owner/profile/documents are current');
select is(private.close_due_keyless_notices_v1(),0,'the scheduler cannot auto-release a live pending claim');
select throws_ok($$select public.read_claim_review_case_v1((select review from keyless_ids))$$,
  '42501','claim review unavailable','the generic documentary read cannot expose the transferred minimum');

create function pg_temp.claim_owner_notice() returns public.mail_outbox language plpgsql as $$
declare picked record; chosen public.mail_outbox; n integer;
begin
  for n in 1..100 loop
    select * into picked from public.claim_mail_outbox();
    if picked.outbox_id is null then raise exception 'synthetic owner notice was not claimed';end if;
    select * into chosen from public.mail_outbox where id=picked.outbox_id;
    if chosen.target_id=(select review from keyless_ids) and chosen.template_id='future-person-owner-notice' then return chosen;end if;
    perform public.complete_mail_attempt(chosen.id,chosen.attempt_count,false,null,'synthetic-other-mail-retry');
  end loop;
  raise exception 'synthetic owner notice claim bound exceeded';
end $$;
-- FROM evaluates the volatile queue claim once; composite projection expands
-- one call per column and would spend the genuine notice on its first call.
create temporary table notice_attempt as select chosen.* from pg_temp.claim_owner_notice() chosen;
select public.complete_mail_attempt((select id from notice_attempt),(select attempt_count from notice_attempt),true,
  pg_temp.keyless_hash('provider-message'),'accepted');
select is(private.commit_keyless_notice_delivery_v1((select review from keyless_ids)),false,
  'provider acceptance alone cannot start the owner notice period');
select ok((select delivered_at is null and notice_deadline is null from public.future_person_claim_notices where owner_account_id is not null),
  'acceptance and elapsed time leave the notice clock unissued');
select is(public.record_resend_mail_event(pg_temp.keyless_hash('provider-message'),pg_temp.keyless_hash('provider-delivered-event'),
  'delivered',clock_timestamp()),true,'the actual canonical event door records only its matched synthetic provider attempt');
select is(private.commit_keyless_notice_delivery_v1((select review from keyless_ids)),true,
  'the exact delivered event commits the fixed owner notice clock');
create temporary table issued_notice as select to_jsonb(n) body from public.future_person_claim_notices n where owner_account_id is not null;
select ok((select notice_deadline=delivered_at+interval '30 days' and provider_attempt_id is not null
  from public.future_person_claim_notices where owner_account_id is not null),'the notice period is exactly30 days from server delivery commit');
select ok((select t.expires_at=n.notice_deadline from public.token_candidates t join public.future_person_claim_notices n on n.candidate_id=t.id
  where n.owner_account_id is not null),'the non-authorizing candidate expiry is clamped to the exact issued notice deadline');
select is(private.commit_keyless_notice_delivery_v1((select review from keyless_ids)),true,'duplicate delivery is idempotent');
select is((select to_jsonb(n) from public.future_person_claim_notices n where owner_account_id is not null),
  (select body from issued_notice),'duplicate delivery never resets the start/deadline or attempt');
select is(private.close_due_keyless_notices_v1(),0,'delivered notice still cannot auto-release');
select is((select count(*) from public.future_person_claims where status='approved'),0::bigint,'no elapsed/callback branch approves a claim');
select throws_ok($$update public.future_person_claim_notices set notice_deadline=notice_deadline+interval '1 second' where owner_account_id is not null$$,
  '55000','immutable owner notice','the delivery-started deadline is immutable');

-- A current provider terminal outcome cannot turn into consent or release.
select is(public.record_resend_mail_event(pg_temp.keyless_hash('provider-message'),pg_temp.keyless_hash('provider-bounced-event'),
  'bounced',clock_timestamp()),true,'a real matched synthetic terminal event records failure');
select is(private.commit_keyless_notice_delivery_v1((select review from keyless_ids)),false,'undeliverability closes only this claim');
select ok((select state='closed' and comparison_ciphertext is null and wrapped_comparison_key is null
  and comparison_key_shredded_at is not null and terminal_code='notice_delivery_failed'
  from public.future_person_claim_review_packages),'terminal close erases every minimum comparison/key');
select ok((select count(*)=2 and bool_and(wrapped_document_key is null and document_key_shredded_at is not null)
  from private.claim_document_sessions where intake_id=(select review from keyless_ids)),
  'terminal close erases both independent document keys');
select ok((select status='shredded' and contact_ciphertext is null from public.encrypted_contact_references
  where id=(select contact_id from notice_input)),'the sole claimant delivery reference is shredded');
select is((select count(*) from public.contact_hmac_indexes where contact_reference_id=(select contact_id from notice_input)),
  0::bigint,'no transferred claimant contact index survives');
select ok((select subject=(select to_jsonb(s) from public.subjects s where id=(select subject from keyless_ids))
  and embryo=(select to_jsonb(e) from public.embryos e where id=(select embryo from keyless_ids))
  and profile=(select to_jsonb(fi) from public.future_person_identity fi where id=(select profile from keyless_ids))
  and files=(select jsonb_agg(to_jsonb(f) order by id) from public.genome_files f where subject_id=(select subject from keyless_ids))
  and sources=(select jsonb_agg(to_jsonb(cs) order by file_id) from private.embryo_canonical_sources cs)
  and parts=(select jsonb_agg(to_jsonb(cp) order by id) from private.embryo_canonical_parts cp)
  and cards=(select jsonb_agg(to_jsonb(k) order by key_revision) from public.future_person_record_key_hashes k)
  from notice_preserved),'pending notice and terminal failure preserve byte-identical subject/profile/source/results/Card claimability');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role cross join unnest(array[
  'private.keyless_owner_notice_current_v1(uuid)',
  'private.prepare_keyless_owner_notice_v1(uuid,bigint,text,bytea,bytea,date,boolean,jsonb,jsonb,text,bytea,bytea,uuid,bytea,jsonb)',
  'private.close_keyless_notice_v1(uuid,text)','private.commit_keyless_notice_delivery_v1(uuid)',
  'private.close_due_keyless_notices_v1()']) fn where has_function_privilege(role,fn,'execute')),0::bigint,
  'every API role is denied all prerequisite transactions');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role cross join unnest(array[
  'public.future_person_claim_review_packages','public.future_person_claim_notices']) t
  where has_table_privilege(role,t,'select,insert,update,delete')),0::bigint,'API table access cannot disclose or edit the wrapped minimum/owner notice');
set constraints all immediate;
select * from finish();
rollback;
