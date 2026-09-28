begin;
select plan(81);
-- The Future Person claim documents step (legal-evidence-ingest-v1 for the
-- claim kinds): evidence sessions bound to a live claim, create-only chunk
-- reservations, completion into a quarantined document, the scan verdict and
-- its freshness and SHA-256 binding, refusal and deletion with evidence, the
-- read gate, and cleanup with the claim. Synthetic hashes only; no bytes.
-- Everything rolls back.

delete from private.future_person_claim_intakes;
delete from public.rate_limit_hmac_buckets where action_id = 'api.future-person-claim';

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('claim-documents-test:'||p,'sha256'),'hex') $$;
create function pg_temp.set1(p text) returns jsonb language sql immutable as
 $$ select jsonb_build_object('1', pg_temp.h(p)) $$;
create function pg_temp.blob(p integer) returns bytea language sql volatile as
 $$ select extensions.gen_random_bytes(p) $$;
create function pg_temp.claim(p_tag text) returns text language sql volatile as $$
 select public.start_future_person_claim_v1(pg_temp.h('session:'||p_tag), pg_temp.h('nonce:'||p_tag),
  'keyless-start', null, pg_temp.blob(64), pg_temp.blob(60),
  pg_temp.set1('identifier:'||p_tag), pg_temp.set1('network:'||p_tag))
$$;
create function pg_temp.open(p_claim text, p_tag text, p_kind text default 'future-photo-identity',
  p_bytes integer default 10) returns jsonb language sql volatile as $$
 select public.open_claim_document_session_v1(pg_temp.h('session:'||p_claim), pg_temp.h('create:'||p_tag),
  p_kind, 'application/pdf', p_bytes, pg_temp.h('document:'||p_tag), pg_temp.h('cookie:'||p_tag))
$$;
create function pg_temp.sid(p_tag text) returns uuid language sql stable as
 $$ select id from private.claim_document_sessions where cookie_hash = pg_temp.h('cookie:'||p_tag) $$;
create function pg_temp.reserve(p_tag text, p_sequence integer, p_bytes integer) returns jsonb language sql volatile as
 $$ select public.reserve_claim_document_chunk_v1(pg_temp.sid(p_tag), pg_temp.h('cookie:'||p_tag), p_sequence,
    p_bytes, pg_temp.h('chunk:'||p_tag||':'||p_sequence)) $$;
create function pg_temp.settle(p_tag text, p_sequence integer, p_written boolean default true) returns text language sql volatile as
 $$ select public.settle_claim_document_chunk_v1(pg_temp.sid(p_tag), pg_temp.h('cookie:'||p_tag), p_sequence, p_written) $$;
create function pg_temp.begin(p_tag text, p_count integer, p_nonce text default null) returns jsonb language sql volatile as
 $$ select public.begin_claim_document_completion_v1(pg_temp.sid(p_tag), pg_temp.h('cookie:'||p_tag),
    pg_temp.h('complete:'||coalesce(p_nonce, p_tag)), p_count) $$;
create function pg_temp.finish(p_tag text, p_outcome text, p_key text) returns jsonb language sql volatile as
 $$ select public.finish_claim_document_completion_v1(pg_temp.sid(p_tag), pg_temp.h('cookie:'||p_tag),
    pg_temp.h('complete:'||p_tag), p_outcome, p_key) $$;
-- A complete, composed, quarantined document for tag p_tag on claim p_claim.
create function pg_temp.quarantined(p_claim text, p_tag text) returns uuid language plpgsql volatile as $$
declare v_plan jsonb;
begin
  perform pg_temp.open(p_claim, p_tag, 'future-birth-record', 10);
  perform pg_temp.reserve(p_tag, 0, 10);
  perform pg_temp.settle(p_tag, 0);
  v_plan := pg_temp.begin(p_tag, 1);
  perform pg_temp.finish(p_tag, 'composed', v_plan->>'objectKey');
  return (v_plan->>'documentId')::uuid;
end $$;
create function pg_temp.doc(p_id uuid) returns private.claim_documents language sql stable as
 $$ select d from private.claim_documents d where d.id = p_id $$;
create function pg_temp.readable(p_id uuid) returns boolean language sql stable as
 $$ select exists (select 1 from private.claim_document_review_object_v1(p_id)) $$;

-- ---------------------------------------------------------------------------
-- The bucket.
select ok(exists (select 1 from storage.buckets where id = 'future-person-identity' and public = false
  and file_size_limit = 20000028 and allowed_mime_types = array['application/octet-stream']),
  'the future-person-identity bucket is private, sealed bytes only, one document at most');
select ok(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') || coalesce(with_check, '')) like '%future-person-identity%'),
  'no Storage policy lets a client reach it');

-- ---------------------------------------------------------------------------
-- Opening an evidence session.
select is(pg_temp.claim('a'), 'received', 'claim a started');
select throws_ok($$select public.open_claim_document_session_v1(pg_temp.h('session:a'), pg_temp.h('create:x'),
  'appeal-photo-identity', 'application/pdf', 10, pg_temp.h('d'), pg_temp.h('c:x'))$$, '22023', null,
  'a kind outside the claim kinds is refused');
select throws_ok($$select public.open_claim_document_session_v1(pg_temp.h('session:a'), pg_temp.h('create:x'),
  'future-photo-identity', 'image/gif', 10, pg_temp.h('d'), pg_temp.h('c:x'))$$, '22023', null,
  'a media type outside PDF, JPEG and PNG is refused');
select throws_ok($$select public.open_claim_document_session_v1(pg_temp.h('session:a'), pg_temp.h('create:x'),
  'future-photo-identity', 'application/pdf', 20000001, pg_temp.h('d'), pg_temp.h('c:x'))$$, '22023', null,
  'a document over 20,000,000 bytes is refused');
select throws_ok($$select public.open_claim_document_session_v1(pg_temp.h('session:nobody'), pg_temp.h('create:x'),
  'future-photo-identity', 'application/pdf', 10, pg_temp.h('d'), pg_temp.h('c:x'))$$, '42501', null,
  'a claim cookie naming no live claim opens nothing');
select ok(public.claim_session_live_v1(pg_temp.h('session:a')), 'the claim page can tell a live claim');
select ok(not public.claim_session_live_v1(pg_temp.h('session:nobody')), 'and an unknown one');
select is(pg_temp.open('a', 'a1')->>'status', 'open', 'a live claim opens a session');
select ok((select s.expires_at <= i.expires_at from private.claim_document_sessions s
  join private.future_person_claim_intakes i on i.id = s.intake_id where s.id = pg_temp.sid('a1')),
  'a session never outlives its claim');
select throws_ok($$select pg_temp.open('a', 'a1')$$, '23505', null, 'the create nonce is one-time');
select is(pg_temp.open('a', 'a2')->>'status', 'open', 'a second session');
select is(pg_temp.open('a', 'a3')->>'status', 'open', 'a third session');
select is(pg_temp.open('a', 'a4')->>'status', 'capacity_limited', 'a fourth open session is limited');
select is((select count(*) from private.claim_document_sessions where cookie_hash = pg_temp.h('cookie:a4')),
  0::bigint, 'and writes nothing');

-- ---------------------------------------------------------------------------
-- Chunks.
select throws_ok($$select public.reserve_claim_document_chunk_v1(pg_temp.sid('a1'), pg_temp.h('cookie:a2'), 0, 5,
  pg_temp.h('x'))$$, '42501', null, 'another session''s cookie reserves nothing');
select throws_ok($$select pg_temp.reserve('a1', 5, 5)$$, '23505', null, 'a sequence past the fifth is refused');
select ok(pg_temp.reserve('a1', 0, 6)->>'objectKey' ~
  ('^' || (select intake_id from private.claim_document_sessions where id = pg_temp.sid('a1'))::text || '/'
   || (select document_id from private.claim_document_sessions where id = pg_temp.sid('a1'))::text || '/[0-9a-f-]{36}$'),
  'the database makes the key: claim, document, a random name');
select throws_ok($$select pg_temp.reserve('a1', 0, 6)$$, '23505', null, 'a sequence is written once');
select is(pg_temp.settle('a1', 0), 'written', 'the write is settled');
select is(pg_temp.reserve('a1', 1, 5)->>'status', 'invalid', 'bytes past the declared size end the session');
select is((select state || ':' || failure_code from private.claim_document_sessions where id = pg_temp.sid('a1')),
  'failed:integrity', 'with the closed integrity code');
select is((select count(*) from private.claim_document_fragments where session_id = pg_temp.sid('a1')
  and state = 'delete_pending'), 1::bigint, 'and its written fragment awaits deletion');
select throws_ok($$select pg_temp.reserve('a1', 1, 4)$$, '42501', null, 'a failed session takes nothing more');
select is(pg_temp.reserve('a2', 0, 4)->>'status', 'reserved', 'a2 reserved');
select is(pg_temp.settle('a2', 0, false), 'failed', 'a failed Storage write ends the session');
select is((select failure_code from private.claim_document_sessions where id = pg_temp.sid('a2')), 'storage',
  'with the closed storage code');

-- ---------------------------------------------------------------------------
-- Completion.
select is(pg_temp.reserve('a3', 0, 6)->>'status', 'reserved', 'a3 chunk 0');
select is(pg_temp.settle('a3', 0), 'written', 'a3 chunk 0 written');
select is(pg_temp.reserve('a3', 1, 4)->>'status', 'reserved', 'a3 chunk 1');
select is(pg_temp.settle('a3', 1), 'written', 'a3 chunk 1 written');
create temporary table plan_a3 as select pg_temp.begin('a3', 2) as plan;
select is((select plan->>'status' from plan_a3), 'compose', 'an exact contiguous manifest composes');
select is((select jsonb_array_length(plan->'fragments') from plan_a3), 2, 'from exactly its two fragments');
select is(pg_temp.begin('a3', 2)->>'status', 'composing', 'the same nonce asks again and learns only the status');
select throws_ok($$select pg_temp.begin('a3', 2, 'other')$$, '23505', null, 'another nonce cannot complete it again');
select throws_ok($$select pg_temp.finish('a3', 'composed', (select intake_id::text || '/' || gen_random_uuid()::text
  || '/' || gen_random_uuid()::text from private.claim_document_sessions where id = pg_temp.sid('a3')))$$,
  '22023', null, 'the composed object must sit under this document');
select is(pg_temp.finish('a3', 'composed', (select plan->>'objectKey' from plan_a3))->>'status', 'scanning',
  'a composed document is quarantined for scanning');
select is((pg_temp.doc((select (plan->>'documentId')::uuid from plan_a3))).state, 'quarantined',
  'its row says quarantined');
select ok(not pg_temp.readable((select (plan->>'documentId')::uuid from plan_a3)),
  'nothing can read a quarantined document');
select is((select count(*) from private.claim_document_fragments where session_id = pg_temp.sid('a3')
  and state = 'delete_pending'), 2::bigint, 'its fragments await deletion');
select throws_ok($$update private.claim_documents set state = 'clean', scan_verdict = 'OK',
  scanned_sha256 = sha256, scan_engine = 'x', scan_signature_version = 1, scan_signature_at = now(),
  scanned_at = now()$$, '42501', null, 'no update can mark a document clean without a recorded scan');

-- A mismatched manifest is refused, never composed.
select is(pg_temp.open('a', 'a5', 'future-birth-record', 10)->>'status', 'open', 'a5 opened after a1 and a2 failed');
select is(pg_temp.reserve('a5', 1, 4)->>'status', 'reserved', 'a5 chunk 1 only');
select is(pg_temp.settle('a5', 1), 'written', 'written');
select is(pg_temp.begin('a5', 1)->>'reason', 'integrity', 'a manifest with a gap is refused as integrity');

-- ---------------------------------------------------------------------------
-- The scan.
create temporary table scan1 as select public.claim_next_claim_document_scan_v1(pg_temp.h('lease:1')) as job;
select is((select (job->>'documentId')::uuid from scan1), (select (plan->>'documentId')::uuid from plan_a3),
  'the worker takes the quarantined document');
select is(public.claim_next_claim_document_scan_v1(pg_temp.h('lease:2')), null, 'no second worker takes it while leased');
select throws_ok($$select public.record_claim_document_scan_v1((select (job->>'documentId')::uuid from scan1),
  pg_temp.h('lease:1'), 'OK', pg_temp.h('other-bytes'), 'ClamAV 1.4.1', 27400, now())$$, '22023', null,
  'an OK for other bytes is refused');
select throws_ok($$select public.record_claim_document_scan_v1((select (job->>'documentId')::uuid from scan1),
  pg_temp.h('lease:1'), 'OK', (select job->>'sha256' from scan1), 'ClamAV 1.4.1', 27400, now() - interval '25 hours')$$,
  '22023', null, 'an OK under signatures older than a day is refused');
select throws_ok($$select public.record_claim_document_scan_v1((select (job->>'documentId')::uuid from scan1),
  pg_temp.h('lease:2'), 'OK', (select job->>'sha256' from scan1), 'ClamAV 1.4.1', 27400, now())$$,
  '42501', null, 'a verdict without the lease is refused');
select throws_ok($$select public.record_claim_document_scan_v1((select (job->>'documentId')::uuid from scan1),
  pg_temp.h('lease:1'), 'CLEAN', (select job->>'sha256' from scan1), 'ClamAV 1.4.1', 27400, now())$$,
  '22023', null, 'only the literal OK is a clean verdict');
select is((pg_temp.doc((select (job->>'documentId')::uuid from scan1))).state, 'quarantined',
  'after every refused verdict the document is still quarantined');
select is(public.record_claim_document_scan_v1((select (job->>'documentId')::uuid from scan1), pg_temp.h('lease:1'),
  'OK', (select job->>'sha256' from scan1), 'ClamAV 1.4.1', 27400, now() - interval '2 hours'), 'clean',
  'a fresh OK bound to the bytes marks it clean');
select ok(pg_temp.readable((select (job->>'documentId')::uuid from scan1)), 'only now can the review read it');
select throws_ok($$update private.claim_documents set state = 'refused', refusal_code = 'infected'
  where id = (select (job->>'documentId')::uuid from scan1)$$, '42501', null, 'a clean verdict is final');
select is(pg_temp.begin('a3', 2)->>'status', 'review_pending', 'the claimant sees review_pending');

-- An infected document is refused, unreadable at once, and its object deleted with evidence.
select is(pg_temp.claim('b'), 'received', 'claim b started');
create temporary table infected as select pg_temp.quarantined('b', 'b1') as id;
create temporary table scan2 as select public.claim_next_claim_document_scan_v1(pg_temp.h('lease:3')) as job;
select is(public.record_claim_document_scan_v1((select id from infected), pg_temp.h('lease:3'), 'FOUND',
  (select job->>'sha256' from scan2), 'ClamAV 1.4.1', 27400, now()), 'delete', 'an infected document must be deleted');
select is((select state || ':' || refusal_code from private.claim_documents where id = (select id from infected)),
  'refused:infected', 'it is refused as infected');
select ok(not pg_temp.readable((select id from infected)), 'and nothing can read it');
select is(pg_temp.begin('b1', 1)->>'reason', 'infected', 'the claimant gets the coded refusal');
select ok((select job->>'objectKey' from scan2) in (select * from public.claim_document_objects_due_v1(100)),
  'its object is due for deletion');
select is(public.confirm_claim_document_objects_deleted_v1(array[(select job->>'objectKey' from scan2)],
  'jobs.claim-document-scan'), 1, 'the deletion is confirmed');
select ok((select object_deleted_at is not null from private.claim_documents where id = (select id from infected)),
  'the document records when its object was deleted');
select is((select coded_context from public.legal_audit_log where event_code = 'claim.document.deleted'
  order by seq desc limit 1), '{"reason": "infected"}'::jsonb, 'and the ledger records why, with no identifier');

-- Unavailable scanners retry, and give up as unscannable.
select is(pg_temp.claim('c'), 'received', 'claim c started');
create temporary table retry as select pg_temp.quarantined('c', 'c1') as id;
update private.claim_documents set scan_attempts = 4 where id = (select id from retry);
create temporary table scan3 as select public.claim_next_claim_document_scan_v1(pg_temp.h('lease:4')) as job;
select is(public.record_claim_document_scan_v1((select id from retry), pg_temp.h('lease:4'), 'UNAVAILABLE',
  null, null, null, null), 'delete', 'after the last attempt an unreachable scanner refuses as unscannable');
select is((select refusal_code from private.claim_documents where id = (select id from retry)), 'unscannable',
  'never clean');

-- A claim is never purged while a document object behind it remains.
select is(pg_temp.claim('d'), 'received', 'claim d started');
create temporary table kept as select pg_temp.quarantined('d', 'd1') as id;
select is(public.confirm_claim_document_objects_deleted_v1(array(
  select f.object_key from private.claim_document_fragments f
  join private.claim_document_sessions s on s.id = f.session_id
  where s.intake_id = (select intake_id from private.claim_documents where id = (select id from kept))),
  'api.evidence-complete'), 1, 'd1''s fragment is deleted once composed');
update private.future_person_claim_intakes set created_at = x.t - interval '25 hours',
  expires_at = x.t - interval '1 hour', last_active_at = x.t - interval '25 hours'
from (select clock_timestamp() t) x where session_hash = pg_temp.h('session:d');
select is(public.purge_future_person_claim_intakes_v1(), 0,
  'an ended claim whose document object is not yet deleted is kept');

-- ---------------------------------------------------------------------------
-- Everything goes with the claim.
update private.future_person_claim_intakes set created_at = x.t - interval '25 hours',
  expires_at = x.t - interval '1 hour', last_active_at = x.t - interval '25 hours'
from (select clock_timestamp() t) x where session_hash = pg_temp.h('session:a');
select is(public.purge_future_person_claim_intakes_v1(), 0, 'an ended claim with objects left is kept');
select ok((select count(*) from public.claim_document_objects_due_v1(100)) >= 4,
  'every object of the ended claim is due');
select is(public.confirm_claim_document_objects_deleted_v1(array(select * from public.claim_document_objects_due_v1(100)),
  'jobs.retention') > 0, true, 'the retention job confirms their deletion');
select is(public.purge_future_person_claim_intakes_v1() >= 1, true, 'then the claim is purged');
select is((select count(*) from private.claim_document_sessions s where not exists (
  select 1 from private.future_person_claim_intakes i where i.id = s.intake_id)), 0::bigint,
  'with every session, fragment and document row');

-- ---------------------------------------------------------------------------
-- Privileges.
select ok(not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r,
  unnest(array['private.claim_document_sessions', 'private.claim_document_fragments', 'private.claim_documents']) t
  where has_table_privilege(r, t, 'select') or has_table_privilege(r, t, 'insert')
    or has_table_privilege(r, t, 'update') or has_table_privilege(r, t, 'delete')),
  'no API role reads or writes a session, fragment or document row');
select ok(not has_function_privilege('anon', 'public.claim_next_claim_document_scan_v1(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_claim_document_scan_v1(uuid,text,text,text,text,bigint,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.record_claim_document_scan_v1(uuid,text,text,text,text,bigint,timestamptz)', 'execute'),
  'only the service role calls the scan doors');
select ok(not has_function_privilege('service_role', 'private.claim_document_review_object_v1(uuid)', 'execute'),
  'no API role can call the read gate');
select is((select count(*) from public.purge_target_stores where store_name in
  ('private.claim_document_sessions', 'private.claim_document_fragments', 'private.claim_documents')), 3::bigint,
  'all three stores are in the purge register');

select * from finish();
rollback;
