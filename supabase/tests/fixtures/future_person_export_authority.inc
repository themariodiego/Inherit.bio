-- The original export predecessor and every original assertion, reused
-- unchanged by both member and exact audit integration tests.
-- Metadata-only SQL proof: actual name encryption/decoding is independently
-- proved with runtime-random AES keys in future-person-content.test.ts.
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
select ok(has_function_privilege('authenticated','public.decide_claim_review_attested_v1(uuid,bigint,text,text,bytea,bytea,jsonb,date,boolean,uuid,bytea,jsonb)','execute')
 and has_function_privilege('authenticated','public.decide_claim_review_v1(uuid,bigint,text,text,bytea)','execute')
 and not has_function_privilege('authenticated','private.decide_claim_review_v1(uuid,bigint,text,text,bytea)','execute')
 and not has_function_privilege('service_role','public.decide_claim_review_attested_v1(uuid,bigint,text,text,bytea,bytea,jsonb,date,boolean,uuid,bytea,jsonb)','execute'),
 'only the human own-JWT attested decision door can authorize release through the API');
\ir future_person_custody_source.inc
\ir future_person_custody_approved.inc
-- Restore the documentary predecessor. The real attested decision must create
-- every durable claimant, custody and delivery row itself, atomically.
delete from public.future_person_claimant_principals where id=(select claimant from custody_ids);
delete from public.future_person_claims where id=(select review from custody_ids);
delete from public.future_person_claim_sessions where id=(select intake from custody_ids);
delete from public.subject_principals where id=(select principal from custody_ids);
delete from private.claim_review_decisions where review_id=(select review from custody_ids);
delete from private.claim_review_reads where review_id=(select review from custody_ids);
update private.claim_reviews set state='document_review_pending',review_revision=1 where id=(select review from custody_ids);
create function pg_temp.receive(p_document uuid,p_cookie text) returns void language plpgsql as $$
declare d jsonb;proof text;n integer;
begin
 d:=public.open_claim_review_download_v1(p_document,p_cookie);
 perform public.open_claim_review_receipt_v1((d->>'session')::uuid,p_cookie,pg_temp.h('open:'||p_document));
 for n in 0..(d->>'chunkCount')::integer-1 loop
   proof:=pg_temp.h('verified-chunk:'||p_document||':'||n);
   perform public.prepare_claim_review_chunk_receipt_v1((d->>'session')::uuid,p_cookie,n,proof);
   perform public.acknowledge_claim_review_chunk_v1((d->>'session')::uuid,p_cookie,n,proof,pg_temp.h('ack:'||p_document||':'||n));
 end loop;
end $$;
select pg_temp.receive((select photo from custody_ids),pg_temp.h('photo-current'));
select pg_temp.receive((select birth from custody_ids),pg_temp.h('birth-current'));
create function pg_temp.approve() returns jsonb language sql as $$
 select public.decide_claim_review_attested_v1((select review from custody_ids),1,'approve-record-key',pg_temp.h('real-decision'),
   extensions.gen_random_bytes(64),extensions.gen_random_bytes(64),jsonb_build_object('1',pg_temp.h('verified-tuple')),
   ((clock_timestamp() at time zone 'UTC')::date-interval '19 years')::date,true,
   '7e100000-0000-4000-8000-000000000001',extensions.gen_random_bytes(128),jsonb_build_object('1',pg_temp.h('contact')));
$$;
create function pg_temp.probe(p_setup text,p_call text) returns text language plpgsql as $$
declare result text;
begin
 begin execute p_setup;execute p_call into result;raise exception using errcode='ZY001',message='restore synthetic probe';
 exception when sqlstate 'ZY001' then null;end;
 return result;
end $$;
select throws_ok($$select pg_temp.probe('delete from private.claim_review_reads where document_id=(select birth from custody_ids)',
 'select pg_temp.approve()::text')$$,'42501','claim review unavailable','an incomplete birth-record delivery creates no claimant or mail');
select throws_ok($$select pg_temp.probe('update public.embryos set status=''stored'' where id=(select embryo from custody_ids)',
 'select pg_temp.approve()::text')$$,'42501','claim review unavailable','a changed disposition cannot release despite reviewed evidence');
select is((select count(*) from public.future_person_claimant_principals where claim_id=(select review from custody_ids)),0::bigint,
 'every refused approval leaves no durable claimant');
select is(pg_temp.approve()->>'state','release_queued','the real attested decision queues its exact release transaction');
set constraints all immediate;
select ok((select s.lifecycle='claimed_unbound' and s.owner_account_id is null and s.cohort_id is null
 from public.subjects s where s.id=(select subject from custody_ids)),'the same decision detaches the exact subject');
select ok((select state='closed' and resolved_at is not null from private.claim_reviews where id=(select review from custody_ids)),
 'the resolved private review closes without extending any deadline');
select ok((select octet_length(wrapped_data_key)=29 and octet_length(identity_ciphertext)=29
 from private.future_person_claim_intakes where id=(select review from custody_ids)),
 'the original claim-specific key and identity are crypto-shredded immediately');
select ok((select bool_and(wrapped_document_key is null and document_key_shredded_at is not null)
 from private.claim_document_sessions where intake_id=(select review from custody_ids)),
 'the approved record-key decision erases both independent document keys before Storage deletion');
select ok((select documentary_attestation_ciphertext is null and verified_identity_hmac is null
   and verified_date_of_birth is null and octet_length(reason_ciphertext)=29
 from private.claim_review_decisions where review_id=(select review from custody_ids)),
 'the working human identity, attestation and reason do not survive final release');
create temporary table release_mail as select m.id from public.mail_outbox m
 join public.future_person_claim_notices n on n.outbox_id=m.id where n.claim_id=(select review from custody_ids) and n.notice_kind='release';
select is((select count(*) from release_mail),1::bigint,'exactly one release mail event commits in the approval transaction');
select ok((select template_id='future-person-release' and purpose='approved-future-person-release' and target_kind='claimed-subject'
 and target_id=(select subject from custody_ids) and template_payload='{}'::jsonb
 and expires_at<=created_at+interval '7 days' from public.mail_outbox where id=(select id from release_mail)),
 'mail has only a fixed template and exact purpose/target/revision with the registered seven-day bound');
create function pg_temp.claim_release() returns table(outbox_id uuid,key text,attempt smallint,token text) language plpgsql as $$
declare r record;n integer;
begin for n in 1..30 loop
 select * into r from public.claim_mail_outbox();
 if r.outbox_id is null then return;end if;
 if r.outbox_id=(select id from release_mail) then return query select r.outbox_id,r.idempotency_key,r.attempt_ordinal,r.delivery_token;return;end if;
 end loop;end $$;
create temporary table delivered as select * from pg_temp.claim_release();
select ok((select token~'^[A-Za-z0-9_-]{43}$' from delivered),'the worker makes a bounded-runtime release token');
select ok(private.authorize_mail_submission_v1((select outbox_id from delivered),(select attempt from delivered)),
 'pre-submit rechecks the exact approved claimant and current source binding');
\ir mail_attempt_retry.inc
select * from pg_temp.assert_mail_retry((select outbox_id from delivered),(select key from delivered),(select token from delivered));
select is(pg_temp.probe('update public.future_person_claimant_principals set release_revision=release_revision+1
 where claim_id=(select review from custody_ids)',
 'select private.authorize_mail_submission_v1((select outbox_id from delivered),(select attempt from delivered))::text'),
 'false','a replaced release authority cancels the old provider attempt');
select public.complete_mail_attempt((select outbox_id from delivered),(select attempt from delivered),true,pg_temp.h('provider'),'accepted');
-- The owner fixture probes the real shared session trigger before the genuine
-- one-time activation consumes this exact issued hash. Each setup rolls back.
create function pg_temp.forge_release_session() returns uuid language sql as $$
 insert into public.rights_sessions(token_hash_id,principal_id,purpose,target_kind,target_id,
   authority_revision,session_hash,status,expires_at,created_at)
 select h.id,cp.principal_id,'approved-future-person-release','claimed-subject',r.subject_id,
   r.credential_revision,pg_temp.h('forged-future-session'),'active',
   least(clock_timestamp()+interval '30 minutes',r.expires_at),clock_timestamp()
 from public.future_person_claim_release_credentials r
 join public.token_hashes h on h.candidate_id=r.candidate_id and h.token_hash=r.credential_hash
 join public.future_person_claimant_principals cp on cp.id=r.claimant_principal_id
 where r.claim_id=(select review from custody_ids) returning id;
$$;
select throws_ok($$select pg_temp.probe('update public.token_candidates set state=''pending''
 where outbox_id=(select id from release_mail)','select pg_temp.forge_release_session()::text')$$,
 '42501','rights purpose unavailable','a current Future hash still cannot authorize a candidate that was never issued');
select throws_ok($$select pg_temp.probe('update public.token_candidates set expires_at=clock_timestamp()-interval ''1 second''
 where outbox_id=(select id from release_mail)','select pg_temp.forge_release_session()::text')$$,
 '42501','rights purpose unavailable','an expired Future candidate cannot create a session despite a current credential');
select throws_ok($$select pg_temp.probe('update public.token_hashes set token_revision=token_revision+1
 where candidate_id=(select id from public.token_candidates where outbox_id=(select id from release_mail))',
 'select pg_temp.forge_release_session()::text')$$,
 '42501','rights purpose unavailable','the exact issued hash revision must equal the candidate and claimant credential revisions');
select throws_ok($$select pg_temp.probe('update public.token_hashes set status=''revoked'',ended_at=clock_timestamp()
 where candidate_id=(select id from public.token_candidates where outbox_id=(select id from release_mail))',
 'select pg_temp.forge_release_session()::text')$$,
 '42501','rights purpose unavailable','a revoked Future hash cannot create a session');
select is((select count(*) from public.rights_sessions where session_hash=pg_temp.h('forged-future-session')),0::bigint,
 'all forged Future session attempts leave no rights row');
create temporary table activated as select * from public.activate_rights_session_v1(
 encode(extensions.digest(convert_to((select token from delivered),'UTF8'),'sha256'),'hex'),pg_temp.h('rights'),
 'future-person-activation-nonce-aaaaaaaa');
select is((select purpose||':'||target_kind from activated),'approved-future-person-release:claimed-subject',
 'activation selects the claimant purpose and one claimed subject');
select ok((select expires_at<=created_at+interval '60 minutes' from public.rights_sessions where session_hash=pg_temp.h('rights')),
 'activation has the registered absolute sixty-minute session bound');
select is((select count(*) from public.activate_rights_session_v1(
 encode(extensions.digest(convert_to((select token from delivered),'UTF8'),'sha256'),'hex'),pg_temp.h('rights-replay'),
 'future-person-activation-nonce-bbbbbbbb')),0::bigint,'the raw release credential is consumed exactly once');
select is((select array_agg(k order by k) from jsonb_object_keys(public.future_person_rights_view_v1(pg_temp.h('rights'))) k),
 array['allowedActionIds','lifecycleState','retentionMaximumDays','safeClaimedSubjectLabel'],'the claimant page returns exactly its four registered safe fields');
select ok(not public.future_person_rights_view_v1(pg_temp.h('rights'))::text~'subjectId|claimant|cipher|source|genotype|e2e.local',
 'the page exposes no genetic data, internal identifiers or contact fields');

-- The documentary approval explicitly flushed all deferred invariants above.
-- Restore their declared initial mode before this new atomic export workflow.
set constraints all deferred;
select ok(private.embryo_call_value_hash_v1(1,1000,'A',null,'A/A') is not null,
 'a genuine reference-only call receives an indexed null-aware value hash');
select isnt(private.embryo_call_value_hash_v1(1,1000,'A',null,'A/A'),
 private.embryo_call_value_hash_v1(1,1000,'A','','A/A'),'null and empty alternate values cannot collide');
