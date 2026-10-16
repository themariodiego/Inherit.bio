begin;
select plan(28);
delete from private.future_person_claim_intakes;
delete from public.rate_limit_hmac_buckets where action_id = 'api.future-person-claim';

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('claim-review-test:'||p,'sha256'),'hex') $$;
create function pg_temp.set1(p text) returns jsonb language sql immutable as
 $$ select jsonb_build_object('1', pg_temp.h(p)) $$;
create function pg_temp.blob(p integer) returns bytea language sql volatile as
 $$ select extensions.gen_random_bytes(p) $$;
create function pg_temp.claim(p_tag text, p_mode text default 'keyless-start', p_key text default null)
returns text language sql volatile as $$
 select public.start_future_person_claim_v1(pg_temp.h('session:'||p_tag), pg_temp.h('nonce:'||p_tag),
  p_mode, case when p_mode = 'keyless-start' then null
    else encode(extensions.digest(coalesce(p_key, p_tag), 'sha256'), 'hex') end,
  pg_temp.blob(64), pg_temp.blob(60),
  pg_temp.set1('identifier:'||p_tag), pg_temp.set1('network:'||p_tag))
$$;
-- A clean document of this kind on claim p_claim, through the real steps.
create function pg_temp.clean_document(p_claim text, p_tag text, p_kind text, p_bytes integer default 10,
  p_scan boolean default true)
returns uuid language plpgsql volatile as $$
declare v_plan jsonb; v_job jsonb; v_session uuid; v_sequence integer := 0; v_left integer := p_bytes;
begin
  perform public.open_claim_document_session_v1(pg_temp.h('session:'||p_claim), pg_temp.h('create:'||p_tag),
    p_kind, 'application/pdf', p_bytes, pg_temp.h('document:'||p_tag), pg_temp.h('cookie:'||p_tag),extensions.gen_random_bytes(72));
  v_session := (select id from private.claim_document_sessions where cookie_hash = pg_temp.h('cookie:'||p_tag));
  while v_left > 0 loop
    perform public.reserve_claim_document_chunk_v1(v_session, pg_temp.h('cookie:'||p_tag), v_sequence,
      least(v_left, 4000000), pg_temp.h('chunk:'||p_tag||v_sequence));
    perform public.settle_claim_document_chunk_v1(v_session, pg_temp.h('cookie:'||p_tag), v_sequence, true);
    v_left := v_left - least(v_left, 4000000);
    v_sequence := v_sequence + 1;
  end loop;
  v_plan := public.begin_claim_document_completion_v1(v_session, pg_temp.h('cookie:'||p_tag),
    pg_temp.h('complete:'||p_tag), v_sequence);
  perform public.finish_claim_document_completion_v1((select id from private.claim_document_sessions
    where cookie_hash = pg_temp.h('cookie:'||p_tag)), pg_temp.h('cookie:'||p_tag), pg_temp.h('complete:'||p_tag),
    'composed', v_plan->>'objectKey');
  if not p_scan then return (v_plan->>'documentId')::uuid; end if;
  v_job := public.claim_next_claim_document_scan_v1(pg_temp.h('lease:'||p_tag));
  perform public.record_claim_document_scan_v1((v_job->>'documentId')::uuid, pg_temp.h('lease:'||p_tag), 'OK',
    v_job->>'sha256', 'ClamAV 1.4.1', 27400, now());
  return (v_plan->>'documentId')::uuid;
end $$;
create function pg_temp.review_of(p_claim text) returns uuid language sql stable as
 $$ select id from private.future_person_claim_intakes where session_hash = pg_temp.h('session:'||p_claim) $$;
-- The JWT a reviewer's request carries; set before switching to the authenticated role.
create function pg_temp.jwt(p_account uuid, p_session uuid, p_aal text default 'aal2', p_mfa_age integer default 60)
returns void language sql volatile as $$
 select set_config('request.jwt.claims', jsonb_build_object('sub', p_account, 'role', 'authenticated',
   'aal', p_aal, 'session_id', p_session,
   'iss', (select auth_issuer from private.upload_authorization_config where singleton),
   'aud', 'authenticated', 'exp', floor(extract(epoch from clock_timestamp())) + 3600, 'amr', jsonb_build_array(jsonb_build_object('method', 'totp',
   'timestamp', floor(extract(epoch from clock_timestamp())) - p_mfa_age)))::text, true)
$$;

-- A database fixture supplies service-verified synthetic proofs. Transport
-- tests separately prove the hashes come from complete real plaintext bytes.
create function pg_temp.acknowledge_document(p_session uuid,p_cookie text)
returns void language plpgsql security definer set search_path='' as $$
declare n integer; proof text;
begin
  perform public.open_claim_review_receipt_v1(p_session,p_cookie,pg_temp.h('receipt:'||p_session));
  for n in 0..(select chunk_count-1 from private.claim_review_downloads where id=p_session) loop
    proof:=pg_temp.h('proof:'||p_session||':'||n);
    perform public.prepare_claim_review_chunk_receipt_v1(p_session,p_cookie,n,proof);
    perform public.acknowledge_claim_review_chunk_v1(p_session,p_cookie,n,proof,pg_temp.h('ack:'||p_session||':'||n));
  end loop;
end $$;
create function pg_temp.receive_document(p_document uuid,p_cookie text)
returns void language plpgsql security definer set search_path='' as $$
declare d jsonb;
begin
  d:=public.open_claim_review_download_v1(p_document,p_cookie);
  perform pg_temp.acknowledge_document((d->>'session')::uuid,p_cookie);
end $$;

-- The local synthetic issuer required by the shared authenticated-session gate.
insert into private.upload_authorization_config (singleton, auth_issuer)
values (true, 'http://127.0.0.1:54321/auth/v1')
on conflict (singleton) do update set auth_issuer = excluded.auth_issuer;

-- Two reviewer accounts and an ordinary account, each with a live session.
insert into auth.users (id, email) values
  ('7e000000-0000-4000-8000-000000000001', 'claim-reviewer-one@e2e.local'),
  ('7e000000-0000-4000-8000-000000000002', 'claim-reviewer-two@e2e.local'),
  ('7e000000-0000-4000-8000-000000000003', 'claim-ordinary@e2e.local');
insert into auth.sessions (id, user_id, aal, created_at) values
  ('5e000000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000001', 'aal2', now()),
  ('5e000000-0000-4000-8000-000000000002', '7e000000-0000-4000-8000-000000000002', 'aal2', now()),
  ('5e000000-0000-4000-8000-000000000003', '7e000000-0000-4000-8000-000000000003', 'aal2', now()),
  ('5e000000-0000-4000-8000-000000000004', '7e000000-0000-4000-8000-000000000001', 'aal2', now());
select private.grant_claim_reviewer_v1('7e000000-0000-4000-8000-000000000001');
select private.grant_claim_reviewer_v1('7e000000-0000-4000-8000-000000000002');


-- Atomic claimant rotation preserves the absolute deadline and spends old credentials.
select pg_temp.claim('rotation');
create temporary table rotation as select id,expires_at from private.future_person_claim_intakes where session_hash=pg_temp.h('session:rotation');
select is(public.open_claim_document_session_rotated_v1(pg_temp.h('session:rotation'),pg_temp.h('session:successor'),
  pg_temp.h('create:rotation'),'future-photo-identity','application/pdf',10,pg_temp.h('document:rotation'),pg_temp.h('cookie:rotation'),extensions.gen_random_bytes(72))->>'status','open','document open rotates atomically');
select ok(not public.claim_session_live_v1(pg_temp.h('session:rotation')),'old claimant cookie is invalid');
select ok(public.claim_session_live_v1(pg_temp.h('session:successor')),'successor claimant cookie is live');
select is((select expires_at from private.future_person_claim_intakes where id=(select id from rotation)),(select expires_at from rotation),'rotation never extends the original absolute deadline');
select throws_ok($$select public.open_claim_document_session_rotated_v1(pg_temp.h('session:rotation'),pg_temp.h('session:next'),pg_temp.h('create:next'),'future-birth-record','application/pdf',10,pg_temp.h('document:next'),pg_temp.h('cookie:next'),extensions.gen_random_bytes(72))$$,'42501',null,'old cookie opens no second document');
select throws_ok($$select public.open_claim_document_session_rotated_v1(pg_temp.h('session:successor'),pg_temp.h('session:next'),pg_temp.h('create:rotation'),'future-birth-record','application/pdf',10,pg_temp.h('document:next'),pg_temp.h('cookie:next'),extensions.gen_random_bytes(72))$$,'23505',null,'document nonce remains consumed after rotation');
select throws_ok($$select public.open_claim_document_session_rotated_v1(pg_temp.h('session:successor'),pg_temp.h('session:successor'),pg_temp.h('create:next'),'future-birth-record','application/pdf',10,pg_temp.h('document:next'),pg_temp.h('cookie:next'),extensions.gen_random_bytes(72))$$,'22023',null,'rotation cannot retain the same credential');
select ok(not has_function_privilege('authenticated','public.open_claim_document_session_rotated_v1(text,text,text,text,text,integer,text,text,bytea)','execute'),'claim rotation door is service-only');
select pg_temp.claim('finish');
create temporary table finish_docs as select pg_temp.clean_document('finish','finish-photo','future-photo-identity') photo,pg_temp.clean_document('finish','finish-birth','future-birth-record') birth;
select is(public.complete_future_person_claim_rotated_v1(pg_temp.h('session:finish'),pg_temp.h('session:finished'),pg_temp.h('finish:nonce'),'keyless',(select photo from finish_docs),(select birth from finish_docs))->>'status','received','completion rotates atomically');
select ok(not public.claim_session_live_v1(pg_temp.h('session:finish')) and not public.claim_session_live_v1(pg_temp.h('session:finished')),'completion invalidates old and successor upload authority');
select throws_ok($$select public.complete_future_person_claim_rotated_v1(pg_temp.h('session:finish'),pg_temp.h('session:replayed'),pg_temp.h('finish:nonce'),'keyless',(select photo from finish_docs),(select birth from finish_docs))$$,'42501',null,'old completion credential cannot replay');

select pg_temp.claim('receipt');
create temporary table receipt_docs as select pg_temp.clean_document('receipt','receipt-photo','future-photo-identity',5000001) photo,pg_temp.clean_document('receipt','receipt-birth','future-birth-record') birth;
select public.complete_future_person_claim_v1(pg_temp.h('session:receipt'),pg_temp.h('receipt:finish'),'keyless',(select photo from receipt_docs),(select birth from receipt_docs));
create temporary table receipt_review as select pg_temp.review_of('receipt') id;
select private.assign_claim_review_v1((select id from receipt_review),'7e000000-0000-4000-8000-000000000001');
select pg_temp.jwt('7e000000-0000-4000-8000-000000000001','5e000000-0000-4000-8000-000000000001');
create temporary table receipt_download as select (public.open_claim_review_download_v1((select photo from receipt_docs),pg_temp.h('receipt:cookie'))->>'session')::uuid id;
select is(jsonb_array_length(public.open_claim_review_receipt_v1((select id from receipt_download),pg_temp.h('receipt:cookie'),pg_temp.h('receipt:nonce'))->'chunks'),2,'receipt POST issues exactly one challenge for each chunk');
select throws_ok($$select public.open_claim_review_receipt_v1((select id from receipt_download),pg_temp.h('receipt:cookie'),pg_temp.h('receipt:nonce'))$$,'23505',null,'opening nonce and attempt cannot replay');
select ok(not has_function_privilege('authenticated','public.prepare_claim_review_chunk_receipt_v1(uuid,text,integer,text)','execute'),'reviewer JWT cannot manufacture service byte proofs');
select ok(not has_function_privilege('authenticated','private.settle_claim_review_chunk_receipt_v1(uuid,integer,text,text)','execute'),'reviewer JWT cannot invoke the settlement helper');
select public.authorize_claim_review_chunk_v1((select id from receipt_download),pg_temp.h('receipt:cookie'),0);
select public.authorize_claim_review_chunk_v1((select id from receipt_download),pg_temp.h('receipt:cookie'),1);
select is((select count(*) from private.claim_review_reads where review_id=(select id from receipt_review) and document_id is not null),0::bigint,'even every authorized GET counts zero delivered chunks');
select public.prepare_claim_review_chunk_receipt_v1((select id from receipt_download),pg_temp.h('receipt:cookie'),0,pg_temp.h('receipt:proof0'));
select public.prepare_claim_review_chunk_receipt_v1((select id from receipt_download),pg_temp.h('receipt:cookie'),1,pg_temp.h('receipt:proof1'));
select throws_ok($$select public.acknowledge_claim_review_chunk_v1((select id from receipt_download),pg_temp.h('receipt:cookie'),0,pg_temp.h('wrong-proof'),pg_temp.h('ack:wrong'))$$,'42501',null,'partial or incorrect bytes cannot settle');
select throws_ok($$select public.acknowledge_claim_review_chunk_v1((select id from receipt_download),pg_temp.h('receipt:cookie'),1,pg_temp.h('receipt:proof0'),pg_temp.h('ack:crossed'))$$,'42501',null,'another chunk proof cannot settle');
select lives_ok($$select public.acknowledge_claim_review_chunk_v1((select id from receipt_download),pg_temp.h('receipt:cookie'),0,pg_temp.h('receipt:proof0'),pg_temp.h('ack:0'))$$,'an exact proof settles once');
select throws_ok($$select public.acknowledge_claim_review_chunk_v1((select id from receipt_download),pg_temp.h('receipt:cookie'),0,pg_temp.h('receipt:proof0'),pg_temp.h('ack:0'))$$,'42501',null,'a settled proof cannot replay');
select ok(not private.claim_document_fully_read_v1((select id from receipt_review),'7e000000-0000-4000-8000-000000000001',(select d from private.claim_documents d where id=(select photo from receipt_docs))),'one acknowledged chunk is incomplete');
select lives_ok($$select public.acknowledge_claim_review_chunk_v1((select id from receipt_download),pg_temp.h('receipt:cookie'),1,pg_temp.h('receipt:proof1'),pg_temp.h('ack:1'))$$,'the exact last chunk settles');
select ok(private.claim_document_fully_read_v1((select id from receipt_review),'7e000000-0000-4000-8000-000000000001',(select d from private.claim_documents d where id=(select photo from receipt_docs))),'both exact acknowledged chunks prove complete delivery');
select throws_ok($$select public.decide_claim_review_v1((select id from receipt_review),1,'reject',pg_temp.h('decision:early'),pg_temp.blob(64))$$,'42501',null,'the second unread document still prevents decision');
select private.assign_claim_review_v1((select id from receipt_review),'7e000000-0000-4000-8000-000000000001');
select ok(not private.claim_document_fully_read_v1((select id from receipt_review),'7e000000-0000-4000-8000-000000000001',(select d from private.claim_documents d where id=(select photo from receipt_docs))),'a new assignment invalidates prior receipt evidence');
select throws_ok($$select public.authorize_claim_review_chunk_v1((select id from receipt_download),pg_temp.h('receipt:cookie'),0)$$,'42501',null,'stale assignment cannot deliver');
create temporary table fresh_download as select (public.open_claim_review_download_v1((select photo from receipt_docs),pg_temp.h('fresh:cookie'))->>'session')::uuid id;
select public.open_claim_review_receipt_v1((select id from fresh_download),pg_temp.h('fresh:cookie'),pg_temp.h('fresh:nonce'));
select public.prepare_claim_review_chunk_receipt_v1((select id from fresh_download),pg_temp.h('fresh:cookie'),0,pg_temp.h('fresh:proof'));
select public.open_claim_review_download_v1((select birth from receipt_docs),pg_temp.h('rotated:cookie'));
select throws_ok($$select public.acknowledge_claim_review_chunk_v1((select id from fresh_download),pg_temp.h('fresh:cookie'),0,pg_temp.h('fresh:proof'),pg_temp.h('fresh:ack'))$$,'42501',null,'credential rotation before acknowledgement cannot settle');
select is((select count(*) from private.claim_review_chunk_receipts where download_id=(select id from fresh_download) and acknowledged_at is not null),0::bigint,'canceled or unacknowledged delivery records no receipt');
select * from finish();
rollback;
