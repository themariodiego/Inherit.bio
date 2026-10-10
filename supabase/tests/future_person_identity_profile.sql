begin;
select no_plan();
-- Actual synthetic canonical publication plus the real two-parent transfer.
-- This is not a positive keyless-review or document-delivery receipt.
-- This opaque signed-name envelope supplies only a bounded SQL tuple. Actual
-- encryption/opening of genuine signed names is proved with random keys by
-- review.test.ts; no SQL metadata is a human documentary attestation.
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
\ir fixtures/future_person_custody_source.inc
create temporary table profile_record as select e.* from public.embryos e
  where e.cohort_id=(select cohort_id from live) and e.sample_ordinal=0;
create temporary table profile_proposal as select public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select id from profile_record),'propose','transferred',null,'profile-transfer-propose-0001') body;
select is(public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1',
  (select id from profile_record),'confirm','transferred',(select (body->>'proposalId')::uuid from profile_proposal),
  'profile-transfer-confirm-0001')->>'disposition','transferred','the other real parent commits the transferred disposition');
create function pg_temp.profile_context(p_account uuid default '7a000000-0000-0000-0000-000000000001',
  p_session uuid default '7a000000-0000-4000-8000-0000000000a1',p_signature uuid default null)
returns jsonb language sql as $$
  select public.future_person_profile_context_v1(p_account,p_session,(select id from profile_record),p_signature);
$$;
create temporary table profile_context as select pg_temp.profile_context(p_signature=>(select id from sig_upload)) body;
create temporary table profile_ids as select gen_random_uuid() first_id,gen_random_uuid() second_id;
create function pg_temp.save(p_context jsonb,p_profile uuid,p_nonce text,p_indexes jsonb default jsonb_build_object('1',repeat('a',64)))
returns jsonb language sql as $$
  select public.write_future_person_profile_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',(select id from profile_record),(select id from sig_upload),
    p_context,p_profile,extensions.gen_random_bytes(128),extensions.gen_random_bytes(72),p_indexes,p_nonce);
$$;
create function pg_temp.profile_probe(p_setup text,p_call text) returns text language plpgsql as $$
declare value text;
begin
  begin execute p_setup; execute p_call into value;
    raise exception using errcode='ZY001',message='restore synthetic profile probe';
  exception when sqlstate 'ZY001' then null; end;
  return value;
end $$;
select is((select (body->>'expiresAt')::timestamptz from profile_context),
  (select fixed_deadline from public.retention_rows where retention_id='embryo.transferred-claim-window'
    and target_kind='subject' and target_id=(select subject_id from profile_record) and state in ('scheduled','active')),
  'the context copies the actual committed transfer deadline');
select is((select (body->>'nextIdentityRevision')::bigint from profile_context),1::bigint,'the new profile starts at its actual first revision');
select throws_ok($$select pg_temp.profile_context('7a000000-0000-0000-0000-000000000003',
  '7a000000-0000-4000-8000-0000000000c1')$$,'42501','not_found','a stranger or ownership assertion grants no parent-profile authority');
select throws_ok($$select pg_temp.profile_context('7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000b1')$$,'42501','not_found','another account auth session cannot authorize the parent');
select throws_ok($$select pg_temp.profile_context(p_signature=>'48000000-0000-4000-8000-000000000099')$$,
  '42501','not_found','an invented consent signature is refused');
select throws_ok($$select pg_temp.profile_probe('update auth.sessions set not_after=clock_timestamp()-interval ''1 second''
  where id=''7a000000-0000-4000-8000-0000000000a1''',
  'select pg_temp.profile_context()::text')$$,'42501','not_found','an expired actual Auth session is refused');
select throws_ok($$select pg_temp.profile_probe('update public.profiles set deletion_requested_at=clock_timestamp()
  where id=''7a000000-0000-0000-0000-000000000001''','select pg_temp.profile_context()::text')$$,
  '42501','not_found','an account deletion hold cannot issue or change a profile');
select throws_ok($$select pg_temp.save((select body from profile_context)||'{"recipientSetRevision":99}',
  (select first_id from profile_ids),'profile-stale-save-0000001')$$,'42501','not_found','a forged or stale recipient revision writes nothing');
select is((select count(*) from public.future_person_identity where embryo_id=(select id from profile_record)),0::bigint,
  'every initial refusal left the profile absent');
select is(pg_temp.save((select body from profile_context),(select first_id from profile_ids),'profile-save-original-0001')->>'status',
  'saved','the exact current signed parent recipient can save one profile');
select ok((select profile_format_version=1 and octet_length(wrapped_profile_key)=72
  and match_indexes=jsonb_build_object('1',repeat('a',64)) and octet_length(parent_supplied_ciphertext)=128
  and fixed_expires_at=(select (body->>'expiresAt')::timestamptz from profile_context)
  from public.future_person_identity where id=(select first_id from profile_ids)),
  'only a separately wrapped envelope, keyed indexes and the existing deadline are stored');
select is((select count(*) from public.retention_due_phases dp join public.retention_rows rr on rr.id=dp.retention_row_id
  where rr.retention_id='future-person.identity-match-profile' and rr.target_id=(select subject_id from profile_record)
    and dp.immutable_envelope=jsonb_build_object('profileId',(select first_id from profile_ids),'identityRevision',1)
    and dp.phase_deadline=rr.fixed_deadline),2::bigint,'both exact profile phases use the copied clock and exact profile revision');
select throws_ok($$select pg_temp.profile_probe('select private.begin_hmac_key_rotation_v1(''contact'',2)',
  'update private.hmac_key_versions set state=''retired'',retired_at=clock_timestamp() where keyring=''contact'' and key_revision=1')$$,
  '55000','identity_profile_key_still_required','a held root cannot retire while the current profile lacks the replacement match index');
select throws_ok($$update public.future_person_identity set wrapped_profile_key=extensions.gen_random_bytes(72)
  where id=(select first_id from profile_ids)$$,'55000','immutable_identity_profile','the current profile key cannot be swapped behind its evidence');
select throws_ok($$update public.future_person_identity set fixed_expires_at=fixed_expires_at+interval '1 day'
  where id=(select first_id from profile_ids)$$,'55000','immutable_identity_profile','a profile can never extend its fixed deadline');
select throws_ok($$select pg_temp.save(pg_temp.profile_context(p_signature=>(select id from sig_upload)),
  (select second_id from profile_ids),'profile-save-original-0001')$$,'23505','operation nonce already used','a mutation nonce cannot be replayed after a successful save');
select throws_ok($$select pg_temp.save((select body from profile_context),(select second_id from profile_ids),'profile-save-stale-000001')$$,
  '42501','not_found','a page receipt from before the saved profile cannot overwrite it');
select is(pg_temp.save(pg_temp.profile_context(p_signature=>(select id from sig_upload)),(select second_id from profile_ids),
  'profile-save-replace-00001',jsonb_build_object('1',repeat('a',64),'2',repeat('b',64)))->>'status','saved',
  'a fresh exact receipt replaces the profile and retains both held match revisions');
select ok((select state='superseded' and wrapped_profile_key is null and match_indexes='{}'
    and parent_supplied_ciphertext=decode('00','hex') from public.future_person_identity where id=(select first_id from profile_ids)),
  'replacement crypto-shreds the previous key and removes every old index and ciphertext in the same transaction');
select is((select fixed_expires_at from public.future_person_identity where id=(select second_id from profile_ids)),
  (select fixed_expires_at from public.future_person_identity where id=(select first_id from profile_ids)),
  'replacement preserves the existing window exactly');
select throws_ok($$select pg_temp.profile_probe('select private.begin_hmac_key_rotation_v1(''contact'',2)',
  'select pg_temp.save(pg_temp.profile_context(p_signature=>(select id from sig_upload)),gen_random_uuid(),''profile-rotation-missing-01'',jsonb_build_object(''1'',repeat(''a'',64)))::text')$$,
  '55000','keyed digest set incomplete','rotation refuses a save missing the newly held active match revision');
select is(public.purge_due_future_person_profiles_v1(),0,'an original live deadline is not erased early');
select lives_ok($$select public.delete_future_person_profile_v1('7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',(select id from profile_record),pg_temp.profile_context(),'profile-delete-current-001')$$,
  'the exact current parent can delete only the matching profile');
select ok((select state='shredded' and wrapped_profile_key is null and match_indexes='{}'
    and parent_supplied_ciphertext=decode('00','hex') from public.future_person_identity where id=(select second_id from profile_ids)),
  'delete removes the independent wrapper, every HMAC revision and ciphertext');
select is((select status from public.embryos where id=(select id from profile_record)),'transferred','profile deletion preserves the record disposition');
select is((select count(*) from private.embryo_canonical_sources where embryo_id=(select id from profile_record)),1::bigint,
  'profile deletion preserves the exact canonical source');
select is((select count(*) from public.retention_due_phases dp join public.retention_rows rr on rr.id=dp.retention_row_id
  where rr.retention_id='future-person.identity-match-profile' and rr.target_id=(select subject_id from profile_record)
    and rr.state='complete' and dp.status='succeeded' and dp.terminal_outcome_code='identity_profile_erased'),4::bigint,
  'replacement and delete terminalize only their exact completed deny/purge phases');
select throws_ok($$update public.future_person_identity set state='current',ended_at=null where id=(select first_id from profile_ids)$$,
  '55000','immutable_identity_profile','a crypto-shredded predecessor cannot be revived');
-- Expiry uses an explicitly synthetic overdue envelope, not a shortened real
-- transfer deadline. This cannot authorize any documentary or release action.
insert into public.future_person_identity(id,embryo_id,identity_revision,parent_supplied_ciphertext,identity_hmac,
  hmac_key_revision,envelope_key_revision,profile_format_version,wrapped_profile_key,match_indexes,fixed_expires_at,authority_snapshot)
values('48000000-0000-4000-8000-000000000077',(select id from profile_record),3,extensions.gen_random_bytes(128),repeat('c',64),
  1,1,1,extensions.gen_random_bytes(72),jsonb_build_object('1',repeat('c',64)),clock_timestamp()-interval '1 second','{}');
select is(public.purge_due_future_person_profiles_v1(),1,'the actual clock-selected worker erases the due synthetic profile');
select ok((select state='shredded' and wrapped_profile_key is null and match_indexes='{}'
  and parent_supplied_ciphertext=decode('00','hex') from public.future_person_identity where id='48000000-0000-4000-8000-000000000077'),
  'due retention physically clears every protected profile field without a provider callback');
select is(public.purge_due_future_person_profiles_v1(),0,'repeated expiry is idempotent');
insert into public.future_person_identity(id,embryo_id,identity_revision,parent_supplied_ciphertext,identity_hmac,hmac_key_revision,envelope_key_revision)
  select '48000000-0000-4000-8000-000000000088',e.id,1,decode('deadbeef','hex'),repeat('d',64),1,1
  from public.embryos e where e.cohort_id=(select cohort_id from live) and e.sample_ordinal=2;
select ok((select profile_format_version is null and wrapped_profile_key is null and match_indexes='{}'
  and fixed_expires_at is null and authority_snapshot is null and parent_supplied_ciphertext=decode('deadbeef','hex')
  from public.future_person_identity where id='48000000-0000-4000-8000-000000000088'),
  'legacy ciphertext retains its exact bytes without invented match, envelope, authority or deadline proof');
select throws_ok($$update public.future_person_identity set profile_format_version=1,wrapped_profile_key=extensions.gen_random_bytes(72)
  where id='48000000-0000-4000-8000-000000000088'$$,'55000','immutable_identity_profile','legacy identity cannot be upgraded into independently proven evidence');
select is((select count(*) from unnest(array['anon','authenticated','inherit_upload_only']) role where
  has_function_privilege(role,'public.future_person_profile_context_v1(uuid,uuid,uuid,uuid)','execute')
  or has_function_privilege(role,'public.write_future_person_profile_v1(uuid,uuid,uuid,uuid,jsonb,uuid,bytea,bytea,jsonb,text)','execute')
  or has_function_privilege(role,'public.delete_future_person_profile_v1(uuid,uuid,uuid,jsonb,text)','execute')
  or has_function_privilege(role,'public.purge_due_future_person_profiles_v1()','execute')),0::bigint,
  'ordinary JWTs cannot call the trusted producer or retention executor directly');
select ok(has_function_privilege('service_role','public.write_future_person_profile_v1(uuid,uuid,uuid,uuid,jsonb,uuid,bytea,bytea,jsonb,text)','execute')
  and not has_table_privilege('authenticated','public.future_person_identity','select')
  and not has_function_privilege('service_role','private.erase_future_person_profile_v1(uuid,text,text)','execute'),
  'ordinary sessions cannot read the protected table and service API calls cannot invoke the private erase helper');
select is((select count(*) from public.legal_audit_log where route_id='api.future-person-identity-profile'
  and event_code in ('embryo.identity_profile_saved','embryo.identity_profile_deleted') and coded_context='{}'),4::bigint,
  'two saves, one replacement and one delete each leave only a coded pseudonymized event');
-- The real named-review predecessor supplies clean exact document tuples and
-- live MFA. Restore its pre-decision state; no release or custody is claimed.
\ir fixtures/future_person_custody_approved.inc
delete from public.future_person_claimant_principals where id=(select claimant from custody_ids);
delete from public.future_person_claims where id=(select review from custody_ids);
delete from public.future_person_claim_sessions where id=(select intake from custody_ids);
delete from public.subject_principals where id=(select principal from custody_ids);
delete from private.claim_review_decisions where review_id=(select review from custody_ids);
delete from private.claim_review_reads where review_id=(select review from custody_ids);
update private.claim_reviews set state='document_review_pending',review_revision=1 where id=(select review from custody_ids);
-- The competing review's terminal transition genuinely destroys its intake
-- key. A distinct fresh opaque intake exercises the remaining current Card;
-- no old ciphertext/AAD tuple or shredded credential is reused as authority.
create temporary table fresh_card_intake as select gen_random_uuid() id;
insert into private.future_person_claim_intakes(id,session_hash,form_nonce_hash,mode,key_hash,identity_ciphertext,
  wrapped_data_key,identifier_hmac,identifier_key_revision,network_hmac,network_key_revision,created_at,last_active_at,expires_at,completed_at)
  select f.id,pg_temp.h('fresh-card-session'),pg_temp.h('fresh-card-form'),'record-key',pg_temp.h('record-key'),
    extensions.gen_random_bytes(64),extensions.gen_random_bytes(60),pg_temp.h('fresh-card-identifier'),1,
    pg_temp.h('fresh-card-network'),1,t.n,t.n,t.n+interval '24 hours',t.n
  from fresh_card_intake f cross join(select clock_timestamp() n)t;
select is((select case_kind from private.resolve_claim_case_v1((select i from private.future_person_claim_intakes i
  where id=(select id from fresh_card_intake)))), 'record_key_unmatched_or_ineligible',
  'a genuine open competing review still refuses the fresh matching Card intake');
select is(pg_temp.profile_probe('update private.claim_reviews set state=''closed'',resolved_at=clock_timestamp() where id=(select review from custody_ids)',
  'select (key_hash<>pg_temp.h(''record-key'') and identity_key_shredded_at is not null and octet_length(wrapped_data_key)=29)::text from private.future_person_claim_intakes where id=(select review from custody_ids)'),
  'true','closing the competing predecessor genuinely shreds its claim key and identity wrapper');
select is(pg_temp.profile_probe('update private.claim_reviews set state=''closed'',resolved_at=clock_timestamp() where id=(select review from custody_ids)',
  'select case_kind from private.resolve_claim_case_v1((select i from private.future_person_claim_intakes i where id=(select id from fresh_card_intake)))'),
  'record_key','the fresh Card intake identifies its eligible record without an optional matching profile');
create temporary table card_case as select public.read_claim_review_case_v1((select review from custody_ids)) body;
select ok((select body->>'caseKind'='record_key' and body->'parentIdentityCiphertext'='null'::jsonb
  and jsonb_array_length(body->'recordedParentSigningEvidence')=2
  and not exists(select 1 from jsonb_array_elements(body->'recordedParentSigningEvidence') x
    where x<>jsonb_build_object('nameCiphertext',repeat('ab',64),'role','genetic-parent')) from card_case),
  'the assigned recent-MFA reviewer receives only both genuine prior signed-parent ciphertexts for the profile-free Card');
select throws_ok($$select pg_temp.profile_probe('update private.claim_review_assignments set status=''ended'',ended_at=clock_timestamp() where review_id=(select review from custody_ids)',
  'select public.read_claim_review_case_v1((select review from custody_ids))::text')$$,
  '42501','claim review unavailable','the signed-name fallback grants no authority to an unassigned named reviewer');
select finish();
rollback;
