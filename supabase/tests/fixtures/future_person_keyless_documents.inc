-- Genuine synthetic canonical publication, native two-parent transfer and
-- authorized optional-profile producer. Opaque synthetic document metadata
-- below exercises SQL authority only; it is not a browser delivery, human
-- documentary determination, notice delivery or release receipt.
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
\ir future_person_custody_source.inc
create temporary table keyless_ids as select gen_random_uuid() review,gen_random_uuid() photo_session,
  gen_random_uuid() birth_session,gen_random_uuid() photo,gen_random_uuid() birth,gen_random_uuid() profile,
  e.id embryo,e.subject_id subject from public.embryos e
  where e.cohort_id=(select cohort_id from live) and e.sample_ordinal=0;
create function pg_temp.keyless_hash(t text) returns text language sql immutable as $$
  select encode(extensions.digest('synthetic-keyless:'||t,'sha256'),'hex');
$$;
create temporary table keyless_proposal as select public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select embryo from keyless_ids),'propose','transferred',null,'keyless-transfer-proposal-0001') body;
select is(public.record_embryo_disposition_v1('7a000000-0000-0000-0000-000000000002',
  '7a000000-0000-4000-8000-0000000000b1',(select embryo from keyless_ids),'confirm','transferred',
  (select (body->>'proposalId')::uuid from keyless_proposal),'keyless-transfer-confirm-0001')->>'disposition',
  'transferred','the genuine second parent commits this synthetic transferred record');
create temporary table keyless_profile_context as select public.future_person_profile_context_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select embryo from keyless_ids),(select id from sig_upload)) body;
select is(public.write_future_person_profile_v1('7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',(select embryo from keyless_ids),(select id from sig_upload),
  (select body from keyless_profile_context),(select profile from keyless_ids),extensions.gen_random_bytes(128),
  extensions.gen_random_bytes(72),jsonb_build_object('1',repeat('b',64)),'keyless-profile-save-0001')->>'status',
  'saved','only the actual current parent/signature/profile writer establishes candidate metadata');
-- Like the custody boundary fixture, this explicitly synthetic historical
-- transfer predates the documentary adult DOB. Its genuine current fixed
-- retention deadline remains byte-identical; no real data is backdated.
update public.embryos set transferred_at=clock_timestamp()-interval '20 years' where id=(select embryo from keyless_ids);
insert into private.future_person_claim_intakes(id,session_hash,form_nonce_hash,mode,identity_ciphertext,wrapped_data_key,
  identifier_hmac,identifier_key_revision,network_hmac,network_key_revision,created_at,last_active_at,expires_at)
  select i.review,pg_temp.keyless_hash('session'),pg_temp.keyless_hash('form'),'keyless-start',extensions.gen_random_bytes(64),
    extensions.gen_random_bytes(60),pg_temp.keyless_hash('identifier'),1,pg_temp.keyless_hash('network'),1,t.n,t.n,t.n+interval '24 hours'
  from keyless_ids i cross join(select clock_timestamp() n)t;
insert into private.claim_document_sessions(id,intake_id,document_id,document_kind,media_type,declared_bytes,declared_sha256,
  cookie_hash,create_nonce_hash,complete_nonce_hash,state,expires_at,wrapped_document_key)
  select photo_session,review,photo,'future-photo-identity','application/pdf',10,pg_temp.keyless_hash('photo'),
    pg_temp.keyless_hash('photo-cookie'),pg_temp.keyless_hash('photo-create'),pg_temp.keyless_hash('photo-complete'),
    'finalized',clock_timestamp()+interval '1 hour',extensions.gen_random_bytes(72) from keyless_ids union all
  select birth_session,review,birth,'future-birth-record','application/pdf',10,pg_temp.keyless_hash('birth'),
    pg_temp.keyless_hash('birth-cookie'),pg_temp.keyless_hash('birth-create'),pg_temp.keyless_hash('birth-complete'),
    'finalized',clock_timestamp()+interval '1 hour',extensions.gen_random_bytes(72) from keyless_ids;
insert into private.claim_documents(id,session_id,intake_id,document_kind,media_type,byte_count,sha256,object_key)
  select photo,photo_session,review,'future-photo-identity','application/pdf',10,pg_temp.keyless_hash('photo'),
    review||'/'||photo||'/'||gen_random_uuid() from keyless_ids union all
  select birth,birth_session,review,'future-birth-record','application/pdf',10,pg_temp.keyless_hash('birth'),
    review||'/'||birth||'/'||gen_random_uuid() from keyless_ids;
do $$ declare job jsonb; n integer; lease text; begin
  for n in 1..2 loop
    lease:=pg_temp.keyless_hash('scan:'||n);job:=public.claim_next_claim_document_scan_v1(lease);
    if job is null or not exists(select 1 from keyless_ids where photo=(job->>'documentId')::uuid
      or birth=(job->>'documentId')::uuid) then raise exception 'synthetic scan selected another document'; end if;
    perform public.record_claim_document_scan_v1((job->>'documentId')::uuid,lease,'OK',job->>'sha256',
      'ClamAV synthetic',1,clock_timestamp());
  end loop;
end $$;
select is(public.complete_future_person_claim_v1(pg_temp.keyless_hash('session'),pg_temp.keyless_hash('completion'),
  'keyless',(select photo from keyless_ids),(select birth from keyless_ids)), 'received',
  'actual opaque completion binds the two clean kind-specific documents');
select private.grant_claim_reviewer_v1('7a000000-0000-0000-0000-000000000001');
select private.assign_claim_review_v1((select review from keyless_ids),'7a000000-0000-0000-0000-000000000001');
insert into private.upload_authorization_config(singleton,auth_issuer)
  values(true,'http://127.0.0.1:54321/auth/v1') on conflict(singleton) do update set auth_issuer=excluded.auth_issuer;
create function pg_temp.keyless_lookup(p_revision bigint default 1,p_identity jsonb default jsonb_build_object('1',repeat('a',64)),
  p_profile jsonb default jsonb_build_object('1',repeat('b',64)),p_birth date default
    ((clock_timestamp() at time zone 'UTC')::date-interval '19 years')::date)
returns jsonb language sql as $$
  select public.verify_keyless_claim_documents_v1((select review from keyless_ids),p_revision,p_birth,p_identity,p_profile);
$$;
grant select on keyless_ids to authenticated;
select throws_ok($$select pg_temp.keyless_lookup()$$,'42501','claim review unavailable','no reviewer JWT cannot select a profile');
select set_config('request.jwt.claims',jsonb_build_object('sub','7a000000-0000-0000-0000-000000000001',
  'role','authenticated','session_id','7a000000-0000-4000-8000-0000000000a1','aal','aal2',
  'iss','http://127.0.0.1:54321/auth/v1','aud','authenticated','exp',extract(epoch from clock_timestamp())::bigint+3600,
  'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from clock_timestamp())::bigint-60)))::text,true);
select throws_ok($$select pg_temp.keyless_lookup()$$,'42501','claim review unavailable','reading no actual chunks cannot authorize the documentary lookup');
-- Current exact-kind, assignment, auth-session and digest metadata. The real
-- byte/EOF/client acknowledgement path is independently tested and remains
-- necessary for browser credit; this does not manufacture delivery evidence.
insert into private.claim_review_reads(review_id,reviewer_account_id,auth_session_id,review_revision,document_id,chunk_sequence,
  assignment_revision,document_sha256,delivery_verified_at,account_auth_session_revision,originating_session_revision)
  select review,'7a000000-0000-0000-0000-000000000001'::uuid,'7a000000-0000-4000-8000-0000000000a1'::uuid,1,
    photo,0,1,pg_temp.keyless_hash('photo'),clock_timestamp(),1,1 from keyless_ids;
select throws_ok($$select pg_temp.keyless_lookup()$$,'42501','claim review unavailable','one complete document is still insufficient');
insert into private.claim_review_reads(review_id,reviewer_account_id,auth_session_id,review_revision,document_id,chunk_sequence,
  assignment_revision,document_sha256,delivery_verified_at,account_auth_session_revision,originating_session_revision)
  select review,'7a000000-0000-0000-0000-000000000001'::uuid,'7a000000-0000-4000-8000-0000000000a1'::uuid,1,
    birth,0,1,pg_temp.keyless_hash('birth'),clock_timestamp(),1,1 from keyless_ids;
