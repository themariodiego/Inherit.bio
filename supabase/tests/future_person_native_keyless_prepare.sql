begin;
select no_plan();
-- Real synthetic publication/transfer/profile/scanning/JWT producers.
-- Document metadata below is SQL authority evidence only; no human/native
-- byte, provider or elapsed-owner-notice credit is inferred.
\ir fixtures/future_person_keyless_documents.inc
insert into public.encrypted_contact_references(principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,status)
  select id,extensions.gen_random_bytes(64),pg_temp.keyless_hash('native-owner-contact'),1,principal_revision,'current'
  from public.subject_principals where account_id='7a000000-0000-0000-0000-000000000001'
    and principal_kind='account_subject' and status='active';
create temporary table native_notice_input as select gen_random_uuid() contact_id,
  (pg_temp.keyless_lookup()#>>'{scope,comparisonReceiptDigest}') receipt;
grant select on native_notice_input to authenticated;
create temporary table native_notice_preserved as select
  (select to_jsonb(s) from public.subjects s where id=(select subject from keyless_ids)) subject,
  (select to_jsonb(e) from public.embryos e where id=(select embryo from keyless_ids)) embryo,
  (select jsonb_agg(to_jsonb(f) order by id) from public.genome_files f where subject_id=(select subject from keyless_ids)) files,
  (select jsonb_agg(to_jsonb(cs) order by file_id) from private.embryo_canonical_sources cs) sources;
create function pg_temp.native_prepare(p_parent boolean default true,p_nonce text default 'native-notice-decision',
  p_receipt text default null,p_revision bigint default 1) returns jsonb language sql security invoker as $$
  select public.prepare_keyless_owner_notice_v1((select review from keyless_ids),p_revision,pg_temp.keyless_hash(p_nonce),
    extensions.gen_random_bytes(64),extensions.gen_random_bytes(64),
    ((clock_timestamp() at time zone 'UTC')::date-interval '19 years')::date,p_parent,
    jsonb_build_object('1',repeat('a',64)),jsonb_build_object('1',repeat('b',64)),
    coalesce(p_receipt,(select receipt from native_notice_input)),extensions.gen_random_bytes(128),extensions.gen_random_bytes(72),
    (select contact_id from native_notice_input),extensions.gen_random_bytes(128),jsonb_build_object('1',repeat('c',64)));
$$;
set local role authenticated;
select throws_ok($$select pg_temp.native_prepare(p_parent=>false)$$,'42501','claim review unavailable',
  'the actual authenticated native door cannot replace the documentary parent fact with profile equality');
select throws_ok($$select pg_temp.native_prepare(p_revision=>2)$$,'42501','claim review unavailable',
  'the actual authenticated native door rechecks the current review revision');
select throws_ok($$select pg_temp.native_prepare(p_receipt=>repeat('d',64))$$,'42501','claim review unavailable',
  'the actual authenticated native door refuses an invented comparison receipt');
select is(pg_temp.native_prepare(),jsonb_build_object('claimId',(select review from keyless_ids),
  'state','approved_pending_owner_notice','reviewRevision',2),'own live named reviewer enters exactly the native pending-notice receipt');
select throws_ok($$select pg_temp.native_prepare()$$,'42501','claim review unavailable',
  'replay of the consumed native initial nonce and old review revision cannot prepare a second notice');
reset role;
select is((select count(*) from public.future_person_claim_notices where notice_kind='owner_notice'),1::bigint,
  'one native determination creates precisely one owner notice');
select is((select count(*) from public.future_person_claimant_principals),0::bigint,
  'native initial approval supplies no durable claimant authority');
select is((select count(*) from private.future_person_custody_slices),0::bigint,'native initial approval detaches nothing');
select ok((select identity_key_shredded_at is not null and key_hash is null and octet_length(wrapped_data_key)=29
  from private.future_person_claim_intakes where id=(select review from keyless_ids)),
  'native determination immediately erases the original intake key');
select ok((select k.expires_at=r.created_at+interval '62 days' and k.delivery_deadline=k.documentary_at+interval '24 hours'
  and octet_length(k.wrapped_comparison_key)=72 from public.future_person_claim_review_packages k
  join private.claim_reviews r on r.id=k.review_id),'native wrapper preserves the independently wrapped minimum and both exact fixed clocks');
select ok((select subject=(select to_jsonb(s) from public.subjects s where id=(select subject from keyless_ids))
  and embryo=(select to_jsonb(e) from public.embryos e where id=(select embryo from keyless_ids))
  and files=(select jsonb_agg(to_jsonb(f) order by id) from public.genome_files f where subject_id=(select subject from keyless_ids))
  and sources=(select jsonb_agg(to_jsonb(cs) order by file_id) from private.embryo_canonical_sources cs)
  from native_notice_preserved),'pending native notice preserves the exact original source/subject/embryo/file tuples');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role_name
  where has_function_privilege(role_name,
    'private.prepare_keyless_owner_notice_v1(uuid,bigint,text,bytea,bytea,date,boolean,jsonb,jsonb,text,bytea,bytea,uuid,bytea,jsonb)','execute')),
  0::bigint,'the owner-only private producer is still inaccessible to every API role');
select is((select array_agg(role_name order by role_name) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role_name
  where has_function_privilege(role_name,
    'public.prepare_keyless_owner_notice_v1(uuid,bigint,text,bytea,bytea,date,boolean,jsonb,jsonb,text,bytea,bytea,uuid,bytea,jsonb)','execute')),
  array['authenticated']::text[],'only the own-JWT authenticated native entry is executable');
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select throws_ok($$select pg_temp.native_prepare(p_nonce=>'missing-live-reviewer')$$,'42501','claim review unavailable',
  'authenticated role without the actual own JWT/live MFA session has no native authority');
reset role;
set constraints all immediate;
select * from finish();
rollback;
