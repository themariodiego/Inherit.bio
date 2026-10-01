begin;
select no_plan();
\ir fixtures/future_person_custody_source.inc
\ir fixtures/future_person_custody_approved.inc
select private.detach_future_person_subject_v1((select review from custody_ids));
select private.queue_future_person_release_v1((select review from custody_ids),
  '7e180000-0000-4000-8000-000000000001',extensions.gen_random_bytes(128),jsonb_build_object('1',pg_temp.h('contact-original')));
update private.claim_reviews set state='closed',resolved_at=clock_timestamp() where id=(select review from custody_ids);
set constraints all immediate;
set constraints all deferred;

-- These synthetic provider/EOF receipt calls exercise exact SQL authority and
-- clock transitions. They are not real mail delivery or browser/human proof.
create function pg_temp.activate_latest(p_session text,p_nonce text) returns void language plpgsql as $$
declare r record; selected uuid; n integer; raw text; attempt smallint;
begin
  select o.id into selected from public.mail_outbox o join public.future_person_claim_notices notice on notice.outbox_id=o.id
    where notice.claim_id=(select review from custody_ids) and notice.notice_kind='release'
    order by notice.notice_revision desc limit 1;
  for n in 1..40 loop
    select * into r from public.claim_mail_outbox();
    if r.outbox_id=selected then raw:=r.delivery_token;attempt:=r.attempt_ordinal;exit;end if;
  end loop;
  if raw is null or not private.authorize_mail_submission_v1(selected,attempt) then
    raise exception 'synthetic current release not authorized'; end if;
  perform public.complete_mail_attempt(selected,attempt,true,pg_temp.h('provider:'||p_session),'accepted');
  perform public.activate_rights_session_v1(encode(extensions.digest(convert_to(raw,'UTF8'),'sha256'),'hex'),pg_temp.h(p_session),p_nonce);
  if public.future_person_rights_view_v1(pg_temp.h(p_session)) is null then raise exception 'synthetic rights not activated';end if;
end $$;
select pg_temp.activate_latest('rights-original','documentary-original-activate-0001');
select public.issue_future_person_recovery_key_v1(pg_temp.h('rights-original'),'documentary-original-key-nonce-0001',pg_temp.h('recovery-original'));

create temporary table recovery_ids(review uuid,photo_session uuid,birth_session uuid,photo uuid,birth uuid);
create function pg_temp.new_recovery_review(p_mode text,p_key text) returns void language plpgsql as $$
declare ids record; job jsonb; n integer; lease text;
begin
  delete from recovery_ids;
  insert into recovery_ids values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()) returning * into ids;
  insert into private.future_person_claim_intakes(id,session_hash,form_nonce_hash,mode,key_hash,identity_ciphertext,wrapped_data_key,
    identifier_hmac,identifier_key_revision,network_hmac,network_key_revision,created_at,last_active_at,expires_at)
    select ids.review,pg_temp.h('session:'||ids.review),pg_temp.h('form:'||ids.review),
      case when p_mode='keyless' then 'keyless-start' else p_mode end,p_key,
      extensions.gen_random_bytes(64),extensions.gen_random_bytes(60),pg_temp.h('identifier:'||ids.review),1,
      pg_temp.h('network:'||ids.review),1,t.n,t.n,t.n+interval '24 hours' from(select clock_timestamp() n)t;
  insert into private.claim_document_sessions(id,intake_id,document_id,document_kind,media_type,declared_bytes,declared_sha256,
    cookie_hash,create_nonce_hash,complete_nonce_hash,state,expires_at,wrapped_document_key)
    values(ids.photo_session,ids.review,ids.photo,'future-photo-identity','application/pdf',10,pg_temp.h('photo:'||ids.review),
      pg_temp.h('photo-cookie:'||ids.review),pg_temp.h('photo-create:'||ids.review),pg_temp.h('photo-complete:'||ids.review),
      'finalized',clock_timestamp()+interval '1 hour',extensions.gen_random_bytes(72)),
    (ids.birth_session,ids.review,ids.birth,'future-birth-record','application/pdf',10,pg_temp.h('birth:'||ids.review),
      pg_temp.h('birth-cookie:'||ids.review),pg_temp.h('birth-create:'||ids.review),pg_temp.h('birth-complete:'||ids.review),
      'finalized',clock_timestamp()+interval '1 hour',extensions.gen_random_bytes(72));
  insert into private.claim_documents(id,session_id,intake_id,document_kind,media_type,byte_count,sha256,object_key)
    values(ids.photo,ids.photo_session,ids.review,'future-photo-identity','application/pdf',10,pg_temp.h('photo:'||ids.review),
      ids.review||'/'||ids.photo||'/'||gen_random_uuid()),
    (ids.birth,ids.birth_session,ids.review,'future-birth-record','application/pdf',10,pg_temp.h('birth:'||ids.review),
      ids.review||'/'||ids.birth||'/'||gen_random_uuid());
  for n in 1..2 loop
    lease:=pg_temp.h('scan:'||ids.review||':'||n);job:=public.claim_next_claim_document_scan_v1(lease);
    if (job->>'documentId')::uuid not in(ids.photo,ids.birth) then raise exception 'unexpected synthetic scan';end if;
    perform public.record_claim_document_scan_v1((job->>'documentId')::uuid,lease,'OK',job->>'sha256','ClamAV synthetic',1,clock_timestamp());
  end loop;
  perform public.complete_future_person_claim_v1(pg_temp.h('session:'||ids.review),pg_temp.h('complete:'||ids.review),
    case when p_mode='keyless' then 'keyless' else p_mode end,ids.photo,ids.birth);
  perform private.assign_claim_review_v1(ids.review,'7a000000-0000-0000-0000-000000000001');
end $$;
create function pg_temp.receive_recovery() returns void language plpgsql as $$
declare doc uuid; d jsonb; cookie text; proof text; n integer;
begin
  for doc in select photo from recovery_ids union all select birth from recovery_ids loop
    cookie:=pg_temp.h('download:'||doc);d:=public.open_claim_review_download_v1(doc,cookie);
    perform public.open_claim_review_receipt_v1((d->>'session')::uuid,cookie,pg_temp.h('receipt-open:'||doc));
    for n in 0..(d->>'chunkCount')::integer-1 loop
      proof:=pg_temp.h('proof:'||doc||':'||n);
      perform public.prepare_claim_review_chunk_receipt_v1((d->>'session')::uuid,cookie,n,proof);
      perform public.acknowledge_claim_review_chunk_v1((d->>'session')::uuid,cookie,n,proof,pg_temp.h('ack:'||doc||':'||n));
    end loop;
  end loop;
end $$;
create function pg_temp.restore(p_decision text default 'approve-recovery-key',p_identity jsonb default jsonb_build_object('1',pg_temp.h('identity')),
  p_receipt text default null) returns jsonb language sql as $$
  select public.restore_future_person_claim_review_v1((select review from recovery_ids),1,p_decision,
    pg_temp.h('decision:'||(select review from recovery_ids)),extensions.gen_random_bytes(64),extensions.gen_random_bytes(64),p_identity,
    ((clock_timestamp() at time zone 'UTC')::date-interval '19 years')::date,
    case when p_decision='approve-claimed-unbound-no-key-recovery' then jsonb_build_object('1',pg_temp.h('profile')) end,p_receipt,
    gen_random_uuid(),extensions.gen_random_bytes(128),jsonb_build_object('1',pg_temp.h('contact-restored')));
$$;
create function pg_temp.probe(p_setup text,p_call text) returns text language plpgsql as $$
declare result text;
begin
  begin execute p_setup;execute p_call into result;raise exception using errcode='ZY001',message='restore synthetic probe';
  exception when sqlstate 'ZY001' then null;end;
  return result;
end $$;
create temporary table durable_before as select jsonb_build_object(
  'subject',(select to_jsonb(s) from public.subjects s where id=(select subject from custody_ids)),
  'embryo',(select to_jsonb(e) from public.embryos e where id=(select embryo from custody_ids)),
  'custody',(select to_jsonb(c) from private.future_person_custody_slices c where subject_id=(select subject from custody_ids)),
  'identity',(select jsonb_agg(to_jsonb(h) order by h.hmac_key_revision) from public.future_person_claimant_identity_hmacs h where claimant_principal_id=(select claimant from custody_ids)),
  'source',(select to_jsonb(c) from private.embryo_canonical_sources c where file_id=(select file from custody_ids)),
  'membership',(select jsonb_agg(to_jsonb(m) order by m.sequence) from private.embryo_canonical_source_parts m where file_id=(select file from custody_ids)),
  'parts',(select jsonb_agg(to_jsonb(p) order by p.sequence) from private.embryo_canonical_parts p join private.embryo_canonical_source_parts m on m.part_id=p.id where m.file_id=(select file from custody_ids)),
  'oldClock',(select fixed_deadline from public.retention_rows where retention_id='future-person.claimed-unbound-24mo' and target_id=(select claimant from custody_ids))) body;
select pg_temp.new_recovery_review('claimant-recovery-key',pg_temp.h('recovery-original'));
select throws_ok($$select pg_temp.restore()$$,'42501','claim review unavailable','a Recovery Key cannot replace complete current document delivery');
select pg_temp.receive_recovery();
select throws_ok($$select pg_temp.restore(p_identity=>jsonb_build_object('1',pg_temp.h('different-person')))$$,
  '42501','claim review unavailable','verified document identity must match the durable claimant HMAC');
select throws_ok($$select pg_temp.probe('update public.future_person_recovery_key_hashes set status=''revoked'' where claimant_principal_id=(select claimant from custody_ids)',
  'select pg_temp.restore()::text')$$,'42501','claim review unavailable','a revoked matched key cannot authorize restoration');
select throws_ok($$select pg_temp.probe('delete from private.claim_review_reads where document_id=(select birth from recovery_ids)',
  'select pg_temp.restore()::text')$$,'42501','claim review unavailable','one complete document cannot authorize recovery');
select throws_ok($$select pg_temp.probe('update private.claim_review_reads set assignment_revision=99 where review_id=(select review from recovery_ids)',
  'select pg_temp.restore()::text')$$,'42501','claim review unavailable','another assignment cannot satisfy the new human decision');
select throws_ok($$select pg_temp.probe('delete from public.future_person_claimant_identity_hmacs where claimant_principal_id=(select claimant from custody_ids)',
  'select pg_temp.restore()::text')$$,'42501','claim review unavailable','erased claimant identity cannot be reconstructed from a parent profile or review');
select is(pg_temp.restore()->>'state','release_queued','actual fresh Recovery Key decision queues one new existing-principal release');
select throws_ok($$select pg_temp.restore()$$,'42501','claim review unavailable','closed decision and consumed nonce cannot rotate a second release');
select is((select count(*) from public.future_person_claimant_principals),1::bigint,'recovery creates no second claimant or custody');
select is((select release_revision from public.future_person_claimant_principals where id=(select claimant from custody_ids)),2::bigint,'the old release capability is superseded atomically');
select ok((select bool_and(status='revoked') from public.future_person_recovery_key_hashes where claimant_principal_id=(select claimant from custody_ids)),
  'every old Recovery Key stays revoked');
select ok(public.future_person_rights_view_v1(pg_temp.h('rights-original')) is null,'old active rights fail immediately after restoration');
select ok((select bool_and(wrapped_document_key is null and document_key_shredded_at is not null)
  from private.claim_document_sessions where intake_id=(select review from recovery_ids)),'recovery resolution destroys both independent document keys');
select is((select count(*) from public.future_person_claim_notices where notice_kind='owner_notice'),0::bigint,'recovery never invents a parent notice');
select pg_temp.activate_latest('rights-restored','documentary-restored-activate-0001');
select lives_ok($$select public.issue_future_person_recovery_key_v1(pg_temp.h('rights-restored'),'documentary-replacement-key-nonce-0001',pg_temp.h('recovery-replacement'))$$,
  'new current release can show one replacement Recovery Key despite preserved historical revoked rows');
select throws_ok($$select public.issue_future_person_recovery_key_v1(pg_temp.h('rights-restored'),'documentary-replacement-key-nonce-0002',pg_temp.h('recovery-second'))$$,
  '42501','claimant rights unavailable','the same release revision cannot show a second replacement key');
select pg_temp.new_recovery_review('keyless',null);
select pg_temp.receive_recovery();
create temporary table keyless_fresh as select public.verify_keyless_claim_documents_v1((select review from recovery_ids),1,
  ((clock_timestamp() at time zone 'UTC')::date-interval '19 years')::date,
  jsonb_build_object('1',pg_temp.h('identity')),jsonb_build_object('1',pg_temp.h('profile'))) body;
select is((select body->'case'->>'caseKind' from keyless_fresh),'claimed_unbound_no_key_recovery','the existing claimant identity is selected before any parent profile');
select throws_ok($$select pg_temp.restore('approve-claimed-unbound-no-key-recovery',jsonb_build_object('1',pg_temp.h('identity')),repeat('a',64))$$,
  '42501','claim review unavailable','a stale or invented documentary comparison receipt cannot restore authority');
select is(pg_temp.restore('approve-claimed-unbound-no-key-recovery',jsonb_build_object('1',pg_temp.h('identity')),
  (select body->'scope'->>'comparisonReceiptDigest' from keyless_fresh))->>'state','release_queued',
  'actual fresh no-key documentary recovery restores only the exact existing claimant');
select is((select release_revision from public.future_person_claimant_principals where id=(select claimant from custody_ids)),3::bigint,
  'no-key recovery independently rotates working release authority');
select ok(public.future_person_rights_view_v1(pg_temp.h('rights-restored')) is null,'the superseded restored session is refused too');
select is((select count(*) from public.future_person_claimant_principals),1::bigint,'no-key recovery never creates new custody');
select ok((select body->'subject'=(select to_jsonb(s) from public.subjects s where id=(select subject from custody_ids))
  and body->'embryo'=(select to_jsonb(e) from public.embryos e where id=(select embryo from custody_ids))
  and body->'custody'=(select to_jsonb(c) from private.future_person_custody_slices c where subject_id=(select subject from custody_ids))
  and body->'identity'=(select jsonb_agg(to_jsonb(h) order by h.hmac_key_revision) from public.future_person_claimant_identity_hmacs h where claimant_principal_id=(select claimant from custody_ids))
  and body->'source'=(select to_jsonb(c) from private.embryo_canonical_sources c where file_id=(select file from custody_ids))
  and body->'membership'=(select jsonb_agg(to_jsonb(m) order by m.sequence) from private.embryo_canonical_source_parts m where file_id=(select file from custody_ids))
  and body->'parts'=(select jsonb_agg(to_jsonb(p) order by p.sequence) from private.embryo_canonical_parts p join private.embryo_canonical_source_parts m on m.part_id=p.id where m.file_id=(select file from custody_ids))
  and (body->>'oldClock')::timestamptz=(select min(fixed_deadline) from public.retention_rows where retention_id='future-person.claimed-unbound-24mo' and target_id=(select claimant from custody_ids))
  from durable_before),'both recovery branches preserve complete custody/source/provider identity and the original contact clock byte for byte');
select is((select count(*) from unnest(array['anon','service_role','inherit_upload_only']) role where
  has_function_privilege(role,'public.restore_future_person_claim_review_v1(uuid,bigint,text,text,bytea,bytea,jsonb,date,jsonb,text,uuid,bytea,jsonb)','execute')),0::bigint,
  'only the own-JWT named reviewer door can authorize recovery');
set constraints all immediate;
select * from finish();
rollback;
