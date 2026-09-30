-- A named synthetic reviewer's attested predecessor, ready for the internal
-- custody effect. Earlier suites prove every actual upload/scan/receipt door;
-- these metadata fixtures target the authority transition and preservation.
create function pg_temp.h(t text) returns text language sql immutable as $$
  select encode(extensions.digest('synthetic-custody:'||t,'sha256'),'hex');
$$;
create temporary table custody_ids as select gen_random_uuid() review,gen_random_uuid() claimant,
  gen_random_uuid() principal,gen_random_uuid() intake,gen_random_uuid() photo_session,
  gen_random_uuid() birth_session,gen_random_uuid() photo,gen_random_uuid() birth,
  e.id embryo,e.subject_id subject,x.file_id file from public.embryos e
  join private.embryo_canonical_sources x on x.embryo_id=e.id
  where e.cohort_id=(select cohort_id from live) and e.sample_ordinal=0;
update public.embryos set status='transferred',transferred_at=clock_timestamp()-interval '20 years',
  closing_date_state='definitive_transferred_claim_window' where id=(select embryo from custody_ids);
-- Replace this record's current synthetic key without changing other records.
update public.future_person_record_key_hashes set status='revoked',ended_at=clock_timestamp()
  where embryo_id=(select embryo from custody_ids) and status='current';
insert into public.future_person_record_key_hashes(embryo_id,recipient_principal_id,recipient_set_revision,key_revision,key_hash)
  select e.id,recipient_principal_id,recipient_set_revision,100,pg_temp.h('record-key')
  from public.embryos e join public.future_person_record_key_hashes h on h.embryo_id=e.id
  where e.id=(select embryo from custody_ids) order by h.key_revision limit 1;
insert into private.future_person_claim_intakes(id,session_hash,form_nonce_hash,mode,key_hash,identity_ciphertext,
  wrapped_data_key,identifier_hmac,identifier_key_revision,network_hmac,network_key_revision,created_at,last_active_at,expires_at,completed_at)
  select c.review,pg_temp.h('session'),pg_temp.h('form'),'record-key',pg_temp.h('record-key'),
    extensions.gen_random_bytes(64),extensions.gen_random_bytes(60),pg_temp.h('identifier'),1,pg_temp.h('network'),1,
    t.n,t.n,t.n+interval '24 hours',t.n from custody_ids c cross join(select clock_timestamp() n)t;
insert into private.claim_document_sessions(id,intake_id,document_id,document_kind,media_type,declared_bytes,
  declared_sha256,cookie_hash,create_nonce_hash,complete_nonce_hash,state,expires_at)
  select c.photo_session,c.review,c.photo,'future-photo-identity','application/pdf',10,pg_temp.h('photo'),
    pg_temp.h('photo-cookie'),pg_temp.h('photo-create'),pg_temp.h('photo-complete'),'finalized',clock_timestamp()+interval '1 hour'
  from custody_ids c union all
  select c.birth_session,c.review,c.birth,'future-birth-record','application/pdf',10,pg_temp.h('birth'),
    pg_temp.h('birth-cookie'),pg_temp.h('birth-create'),pg_temp.h('birth-complete'),'finalized',clock_timestamp()+interval '1 hour'
  from custody_ids c;
insert into private.claim_documents(id,session_id,intake_id,document_kind,media_type,byte_count,sha256,object_key,
  state,scan_verdict,scanned_sha256,scan_engine,scan_signature_version,scan_signature_at,scanned_at)
  select c.photo,c.photo_session,c.review,'future-photo-identity','application/pdf',10,pg_temp.h('photo'),
    c.review||'/'||c.photo||'/'||gen_random_uuid(),'clean','OK',pg_temp.h('photo'),'ClamAV synthetic',1,now(),now()
  from custody_ids c union all
  select c.birth,c.birth_session,c.review,'future-birth-record','application/pdf',10,pg_temp.h('birth'),
    c.review||'/'||c.birth||'/'||gen_random_uuid(),'clean','OK',pg_temp.h('birth'),'ClamAV synthetic',1,now(),now()
  from custody_ids c;
insert into private.claim_reviews(id,mode,case_kind,matched_embryo_id,photo_document_id,photo_sha256,
  birth_record_document_id,birth_record_sha256,completion_nonce_hash,state,review_revision,created_at,deadline)
  select c.review,'record-key','record_key',c.embryo,c.photo,pg_temp.h('photo'),c.birth,pg_temp.h('birth'),
    pg_temp.h('completion'),'release_queued',2,t.n,t.n+interval '30 days'
  from custody_ids c cross join(select clock_timestamp() n)t;
select private.grant_claim_reviewer_v1('7a000000-0000-0000-0000-000000000001');
insert into private.claim_review_assignments(review_id,reviewer_account_id,assignment_revision)
  select review,'7a000000-0000-0000-0000-000000000001',1 from custody_ids;
insert into private.claim_review_decisions(review_id,review_revision,decision,reviewer_account_id,auth_session_id,
  photo_document_id,photo_sha256,birth_record_document_id,birth_record_sha256,reason_ciphertext,nonce_hash,
  documentary_attestation_ciphertext,verified_identity_hmac,identity_hmac_revision,verified_date_of_birth,recorded_parent_link_confirmed)
  select c.review,1,'approve-record-key','7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',c.photo,pg_temp.h('photo'),c.birth,pg_temp.h('birth'),
    extensions.gen_random_bytes(64),pg_temp.h('decision'),extensions.gen_random_bytes(64),pg_temp.h('identity'),1,
    ((clock_timestamp() at time zone 'UTC')::date-interval '19 years')::date,true from custody_ids c;
insert into public.subject_principals(id,subject_id,principal_kind,status)
  select principal,subject,'future_person','active' from custody_ids;
insert into public.future_person_claim_sessions(id,embryo_id,candidate_principal_id,intake_revision,state,expires_at)
  select intake,embryo,principal,1,'submitted',clock_timestamp()+interval '1 hour' from custody_ids;
insert into public.future_person_claims(id,intake_session_id,embryo_id,claimant_principal_id,claim_method,
  claim_revision,claimant_revision,status,decided_at)
  select review,intake,embryo,principal,'record_key',1,1,'approved',clock_timestamp() from custody_ids;
insert into public.future_person_claimant_principals(id,claim_id,principal_id,claimant_revision,status)
  select claimant,review,principal,1,'current' from custody_ids;
insert into private.claim_review_reads(review_id,reviewer_account_id,auth_session_id,review_revision,document_id,
  chunk_sequence,assignment_revision,document_sha256,delivery_verified_at,account_auth_session_revision,originating_session_revision)
  select review,'7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',1,
    photo,0,1,pg_temp.h('photo'),clock_timestamp(),1,1 from custody_ids union all
  select review,'7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',1,
    birth,0,1,pg_temp.h('birth'),clock_timestamp(),1,1 from custody_ids;
insert into private.upload_authorization_config(singleton,auth_issuer)
values(true,'http://127.0.0.1:54321/auth/v1') on conflict(singleton) do update set auth_issuer=excluded.auth_issuer;
select set_config('request.jwt.claims',jsonb_build_object('sub','7a000000-0000-0000-0000-000000000001',
  'role','authenticated','session_id','7a000000-0000-4000-8000-0000000000a1','aal','aal2',
  'iss','http://127.0.0.1:54321/auth/v1','aud','authenticated','exp',extract(epoch from clock_timestamp())::bigint+3600,
  'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from clock_timestamp())::bigint-60)))::text,true);
