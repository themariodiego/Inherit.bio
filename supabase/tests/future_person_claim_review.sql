begin;
select plan(95);
-- The Future Person claim review, up to the release decision: completion,
-- the case the server resolves, the named reviewer's step-up MFA and
-- assignment, audited reads, decisions bound to the exact documents'
-- digests, refusal, the deadline close and the purge. Synthetic hashes and
-- bytes only. Everything rolls back.

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
    p_kind, 'application/pdf', p_bytes, pg_temp.h('document:'||p_tag), pg_temp.h('cookie:'||p_tag));
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

-- ---------------------------------------------------------------------------
-- Completion.
select is(pg_temp.claim('a'), 'received', 'claim a started (keyless)');
select is(public.claim_session_status_v1(pg_temp.h('session:a')), '{"mode": "keyless", "status": "live"}'::jsonb,
  'a live claim shows the page its stored mode');
create temporary table docs_a as select pg_temp.clean_document('a', 'a-photo', 'future-photo-identity', 5000001) photo,
  pg_temp.clean_document('a', 'a-birth', 'future-birth-record', 10) birth;
select is(public.open_claim_document_session_v1(pg_temp.h('session:a'), pg_temp.h('create:a-open'),
  'future-birth-record', 'application/pdf', 10, pg_temp.h('d'), pg_temp.h('cookie:a-open'))->>'status', 'open',
  'a third, unfinished session is open');
select throws_ok($$select public.complete_future_person_claim_v1(pg_temp.h('session:a'), pg_temp.h('finish:a'),
  'keyless', (select photo from docs_a), (select photo from docs_a))$$, '22023', null,
  'the same document cannot be both');
select throws_ok($$select public.complete_future_person_claim_v1(pg_temp.h('session:nobody'), pg_temp.h('finish:a'),
  'keyless', (select photo from docs_a), (select birth from docs_a))$$, '42501', null,
  'a cookie naming no live claim completes nothing');
select throws_ok($$select public.complete_future_person_claim_v1(pg_temp.h('session:a'), pg_temp.h('finish:a'),
  'record-key', (select photo from docs_a), (select birth from docs_a))$$, '42501', null,
  'the client cannot override the stored mode');
select throws_ok($$select public.complete_future_person_claim_v1(pg_temp.h('session:a'), pg_temp.h('finish:a'),
  'keyless', (select birth from docs_a), (select photo from docs_a))$$, '42501', null,
  'each document must be its own kind');
select is(public.complete_future_person_claim_v1(pg_temp.h('session:a'), pg_temp.h('finish:a'), 'keyless',
  (select photo from docs_a), (select birth from docs_a)), 'received', 'a complete claim is received');
select is((select case_kind from private.claim_reviews where id = pg_temp.review_of('a')), 'keyless_none',
  'the server resolves the case: no keyless profile can match yet');
select ok((select photo_sha256 = (select sha256 from private.claim_documents where id = (select photo from docs_a))
  and birth_record_sha256 = (select sha256 from private.claim_documents where id = (select birth from docs_a))
  and deadline = created_at + interval '30 days' and state = 'document_review_pending'
  from private.claim_reviews where id = pg_temp.review_of('a')),
  'the review binds both documents by digest, with a 30-day deadline');
select is(public.claim_session_status_v1(pg_temp.h('session:a')), '{"status": "completed"}'::jsonb,
  'the claim page sees it completed, and nothing more');
select is((select state || ':' || failure_code from private.claim_document_sessions
  where cookie_hash = pg_temp.h('cookie:a-open')), 'failed:expired', 'the unfinished session ends');
select throws_ok($$select public.complete_future_person_claim_v1(pg_temp.h('session:a'), pg_temp.h('finish:a2'),
  'keyless', (select photo from docs_a), (select birth from docs_a))$$, '42501', null,
  'a completed claim cannot be completed again');
select throws_ok($$select public.open_claim_document_session_v1(pg_temp.h('session:a'), pg_temp.h('create:late'),
  'future-birth-record', 'application/pdf', 10, pg_temp.h('d'), pg_temp.h('cookie:late'))$$, '42501', null,
  'and takes no more documents');
select is((select count(*) from public.legal_audit_log where event_code = 'claim.received'
  and coded_context = '{}'::jsonb), 1::bigint, 'the ledger records claim.received with nothing else');

-- A quarantined document cannot be completed with.
select is(pg_temp.claim('q'), 'received', 'claim q started');
create temporary table docs_q as select pg_temp.clean_document('q', 'q-photo', 'future-photo-identity') photo,
  pg_temp.clean_document('q', 'q-birth', 'future-birth-record', 10, false) birth;
select is((select state from private.claim_documents where id = (select birth from docs_q)), 'quarantined',
  'q''s birth record is still quarantined');
select throws_ok($$select public.complete_future_person_claim_v1(pg_temp.h('session:q'), pg_temp.h('finish:q'),
  'keyless', (select photo from docs_q), (select birth from docs_q))$$, '42501', null,
  'a claim whose birth record is not yet clean cannot complete');
-- Out of the scan queue, so the helper below scans only its own documents.
delete from private.future_person_claim_intakes where id = pg_temp.review_of('q');

-- ---------------------------------------------------------------------------
-- The reviewer's step-up.
create temporary table rv as select pg_temp.review_of('a') id;
grant select on rv, docs_a to authenticated;
select throws_ok($$select public.read_claim_review_case_v1((select id from rv))$$, '42501', null,
  'without a JWT nothing is read');
select pg_temp.jwt('7e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.read_claim_review_case_v1((select id from rv))$$, '42501', null,
  'a reviewer without the assignment reads nothing');
reset role;
select private.assign_claim_review_v1((select id from rv), '7e000000-0000-4000-8000-000000000001');
-- MFA and assignment cannot bypass the shared live-account gate.
select set_config('request.jwt.claims', (current_setting('request.jwt.claims')::jsonb ||
  '{"iss":"http://wrong.e2e.local/auth/v1"}'::jsonb)::text, true);
set local role authenticated;
select throws_ok($$select public.read_claim_review_case_v1((select id from rv))$$, '42501', null,
  'a wrong issuer cannot read a review despite MFA and assignment');
reset role;
select pg_temp.jwt('7e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims', (current_setting('request.jwt.claims')::jsonb ||
  jsonb_build_object('exp', floor(extract(epoch from clock_timestamp())) - 1))::text, true);
set local role authenticated;
select throws_ok($$select public.read_claim_review_case_v1((select id from rv))$$, '42501', null,
  'an expired JWT cannot read a review despite a live session');
reset role;
select pg_temp.jwt('7e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001');
update auth.users set banned_until = clock_timestamp() + interval '1 day'
where id = '7e000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.read_claim_review_case_v1((select id from rv))$$, '42501', null,
  'a suspended reviewer reads no case');
reset role;
update auth.users set banned_until = null, deleted_at = clock_timestamp()
where id = '7e000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.read_claim_review_case_v1((select id from rv))$$, '42501', null,
  'a deleted reviewer reads no case');
reset role;
update auth.users set deleted_at = null where id = '7e000000-0000-4000-8000-000000000001';
update public.profiles set deletion_requested_at = clock_timestamp()
where id = '7e000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.read_claim_review_case_v1((select id from rv))$$, '42501', null,
  'a reviewer on account deletion hold reads no case');
reset role;
update public.profiles set deletion_requested_at = null
where id = '7e000000-0000-4000-8000-000000000001';

select pg_temp.jwt('7e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
select throws_ok($$select public.read_claim_review_case_v1((select id from rv))$$, '42501', null,
  'an assigned reviewer without MFA (AAL1) reads nothing');
reset role;
select pg_temp.jwt('7e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001', 'aal2', 16 * 60);
set local role authenticated;
select throws_ok($$select public.read_claim_review_case_v1((select id from rv))$$, '42501', null,
  'an MFA step-up older than 15 minutes reads nothing');
reset role;
select pg_temp.jwt('7e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-00000000009a');
set local role authenticated;
select throws_ok($$select public.read_claim_review_case_v1((select id from rv))$$, '42501', null,
  'a signed-out session reads nothing');
reset role;
select pg_temp.jwt('7e000000-0000-4000-8000-000000000003', '5e000000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok($$select public.read_claim_review_case_v1((select id from rv))$$, '42501', null,
  'an ordinary account with MFA is not a reviewer');
reset role;
select pg_temp.jwt('7e000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select public.read_claim_review_case_v1((select id from rv))$$, '42501', null,
  'another reviewer, not assigned, reads nothing');
reset role;

select pg_temp.jwt('7e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001');
set local role authenticated;
create temporary table case_a as select public.read_claim_review_case_v1((select id from rv)) c;
reset role;
select is((select c->>'caseKind' from case_a), 'keyless_none', 'the assigned, stepped-up reviewer reads the case');
select is((select c->'allowedDecisions' from case_a), '["reject", "needs-more-information"]'::jsonb,
  'with only the decisions its kind allows');
select ok((select not (c ? 'keyHash') and not (c ? 'matchedEmbryoId') and not (c ? 'networkHmac') from case_a),
  'and no key hash, record or network digest');
select is((select count(*) from private.claim_review_reads where review_id = (select id from rv)
  and document_id is null), 1::bigint, 'the read is recorded');

-- ---------------------------------------------------------------------------
-- Reading the documents, chunk by chunk.
set local role authenticated;
select throws_ok($$select public.open_claim_review_download_v1((select id from private.claim_documents limit 1), 'x')$$,
  '42501', null, 'the authenticated role cannot read private tables to aim a download');
reset role;
select pg_temp.jwt('7e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001');
create temporary table ids as select (select photo from docs_a) photo, (select birth from docs_a) birth,
  pg_temp.h('download:photo') photo_cookie, pg_temp.h('download:birth') birth_cookie;
grant select on ids to authenticated;
set local role authenticated;
create temporary table dl as select
  public.open_claim_review_download_v1((select photo from ids), (select photo_cookie from ids)) photo,
  public.open_claim_review_download_v1((select birth from ids), (select birth_cookie from ids)) birth;
reset role;
select is((select (photo->>'chunkCount')::integer from dl), 2, 'a 5,000,001-byte document is two chunks');
select ok((select not (photo ? 'objectKey') and not (photo ? 'wrappedDataKey') from dl),
  'the download descriptor carries no key');
grant select on dl to authenticated;

-- Decisions need both documents fully read.
create temporary table reason as select pg_temp.blob(64) r;
grant select on reason to authenticated;
set local role authenticated;
select throws_ok($$select public.decide_claim_review_v1((select id from rv), 1, 'reject', pg_temp_nonce.n,
  (select r from reason)) from (select encode(extensions.digest('n1','sha256'),'hex') n) pg_temp_nonce$$,
  '42501', null, 'no decision before the reviewer has read both documents');
reset role;

set local role authenticated;
select ok(public.authorize_claim_review_chunk_v1((select (photo->>'session')::uuid from dl),
  (select photo_cookie from ids), 0) ? 'objectKey', 'photo chunk 0 is authorized');
select throws_ok($$select public.authorize_claim_review_chunk_v1((select (photo->>'session')::uuid from dl),
  (select photo_cookie from ids), 2)$$, '42501', null, 'a sequence past the document is refused');
select throws_ok($$select public.authorize_claim_review_chunk_v1((select (photo->>'session')::uuid from dl),
  (select birth_cookie from ids), 1)$$, '42501', null, 'another download''s cookie is refused');
reset role;
select pg_temp.jwt('7e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok($$select public.authorize_claim_review_chunk_v1((select (photo->>'session')::uuid from dl),
  (select photo_cookie from ids), 1)$$, '42501', null, 'the same reviewer in another session is refused');
reset role;
select pg_temp.jwt('7e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(public.authorize_claim_review_chunk_v1((select (photo->>'session')::uuid from dl),
  (select photo_cookie from ids), 1) ? 'objectKey', 'photo chunk 1 is authorized');
select throws_ok($$select public.decide_claim_review_v1((select id from rv), 1, 'reject',
  encode(extensions.digest('n1','sha256'),'hex'), (select r from reason))$$,
  '42501', null, 'one document read is not enough');
select ok(public.authorize_claim_review_chunk_v1((select (birth->>'session')::uuid from dl),
  (select birth_cookie from ids), 0) ? 'objectKey', 'birth record chunk 0 is authorized');
reset role;
select is((select count(*) from private.claim_review_reads where review_id = (select id from rv)
  and document_id is not null), 3::bigint, 'each chunk read is recorded');

-- A stored download cannot survive an account or originating-session revision change.
update public.profiles set auth_session_revision = auth_session_revision + 1
where id = '7e000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.authorize_claim_review_chunk_v1((select (photo->>'session')::uuid from dl),
  (select photo_cookie from ids), 0)$$, '42501', null, 'a stale account revision revokes the download');
reset role;
update public.profiles set auth_session_revision = auth_session_revision - 1
where id = '7e000000-0000-4000-8000-000000000001';
update auth.sessions set refresh_token_counter = coalesce(refresh_token_counter, 0) + 1
where id = '5e000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.authorize_claim_review_chunk_v1((select (photo->>'session')::uuid from dl),
  (select photo_cookie from ids), 0)$$, '42501', null, 'a stale originating session revision revokes the download');
reset role;
update auth.sessions set refresh_token_counter = refresh_token_counter - 1
where id = '5e000000-0000-4000-8000-000000000001';

-- An idle download ends.
update private.claim_review_downloads set last_used_at = clock_timestamp() - interval '301 seconds'
where cookie_hash = pg_temp.h('download:birth');
set local role authenticated;
select throws_ok($$select public.authorize_claim_review_chunk_v1((select (birth->>'session')::uuid from dl),
  (select birth_cookie from ids), 0)$$, '42501', null, 'five idle minutes end a download');

-- The decision matrix, the revision and the nonce.
select throws_ok($$select public.decide_claim_review_v1((select id from rv), 1, 'keyless-document-match',
  encode(extensions.digest('n1','sha256'),'hex'), (select r from reason))$$,
  '42501', null, 'an approval the case kind does not allow is the opaque 404');
select throws_ok($$select public.decide_claim_review_v1((select id from rv), 7, 'needs-more-information',
  encode(extensions.digest('n1','sha256'),'hex'), (select r from reason))$$,
  '42501', null, 'a stale review revision is refused');
select is(public.decide_claim_review_v1((select id from rv), 1, 'needs-more-information',
  encode(extensions.digest('n1','sha256'),'hex'), (select r from reason)),
  jsonb_build_object('claimId', (select id from rv), 'state', 'more_information_required', 'reviewRevision', 2),
  'needs-more-information moves the case to revision 2');
select throws_ok($$select public.decide_claim_review_v1((select id from rv), 2, 'reject',
  encode(extensions.digest('n1','sha256'),'hex'), (select r from reason))$$,
  '23505', null, 'the decision nonce is one-time');
reset role;
select ok((select photo_sha256 = (select sha256 from private.claim_documents where id = (select photo from docs_a))
  and birth_record_sha256 = (select sha256 from private.claim_documents where id = (select birth from docs_a))
  and reviewer_account_id = '7e000000-0000-4000-8000-000000000001'
  and auth_session_id = '5e000000-0000-4000-8000-000000000001' and review_revision = 1
  from private.claim_review_decisions where review_id = (select id from rv)),
  'the decision is recorded against the exact documents'' digests, reviewer and session');

-- Reject.
select pg_temp.jwt('7e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.decide_claim_review_v1((select id from rv), 2, 'reject',
  encode(extensions.digest('n2','sha256'),'hex'), (select r from reason))->>'state', 'refused',
  'reject refuses the claim');
select throws_ok($$select public.read_claim_review_case_v1((select id from rv))$$, '42501', null,
  'a refused case is no longer readable');
select throws_ok($$select public.authorize_claim_review_chunk_v1((select (photo->>'session')::uuid from dl),
  (select photo_cookie from ids), 0)$$, '42501', null, 'nor are its documents');
reset role;
select ok(not exists (select 1 from private.claim_document_review_object_v1((select photo from docs_a))),
  'the read gate returns nothing for a refused case');
select is((select coded_context from public.legal_audit_log where event_code = 'claim.resolved'
  order by seq desc limit 1), '{"outcome": "refused"}'::jsonb, 'claim.resolved records only the coded outcome');
select ok((select count(*) from public.claim_document_objects_due_v1(100) k
  where k.object_key in (select object_key from private.claim_documents where intake_id = (select id from rv))) = 2,
  'both documents of the refused claim are due for deletion');
select ok(public.confirm_claim_document_objects_deleted_v1(array(select * from public.claim_document_objects_due_v1(100)),
  'jobs.retention') >= 2, 'the retention job deletes them');
update private.future_person_claim_intakes set created_at = x.t - interval '25 hours',
  expires_at = x.t - interval '1 hour', last_active_at = x.t - interval '25 hours', completed_at = x.t - interval '24 hours'
from (select clock_timestamp() t) x where id = (select id from rv);
select ok(public.purge_future_person_claim_intakes_v1() >= 1, 'then the claim is purged');
select is((select count(*) from private.claim_reviews where id = (select id from rv)), 0::bigint,
  'with its review, reads and decisions');

-- ---------------------------------------------------------------------------
-- A Record Key that selects an eligible record, and one that does not.
-- Fabricated with triggers off: no embryo lifecycle can reach this state yet.
set local session_replication_role = replica;
insert into public.embryos (id, cohort_id, subject_id, sample_ordinal, status, disposition_revision,
  retention_expires_at, closing_date_state, date_revision, transferred_at)
values
  ('e0000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(), 0, 'transferred', 1,
   now() + interval '30 years', 'definitive_transferred_claim_window', 1, now() - interval '19 years'),
  ('e0000000-0000-4000-8000-000000000002', gen_random_uuid(), gen_random_uuid(), 1, 'transferred', 1,
   now() + interval '30 years', 'definitive_transferred_claim_window', 1, now() - interval '5 years');
insert into public.future_person_record_key_hashes (embryo_id, recipient_principal_id, recipient_set_revision,
  key_revision, key_hash)
values
  ('e0000000-0000-4000-8000-000000000001', gen_random_uuid(), 1, 1, encode(extensions.digest('RECORDKEYONE', 'sha256'), 'hex')),
  ('e0000000-0000-4000-8000-000000000002', gen_random_uuid(), 1, 1, encode(extensions.digest('RECORDKEYTWO', 'sha256'), 'hex'));
insert into public.future_person_identity (embryo_id, identity_revision, parent_supplied_ciphertext, identity_hmac,
  hmac_key_revision, envelope_key_revision)
values
  ('e0000000-0000-4000-8000-000000000001', 1, pg_temp.blob(64), pg_temp.h('profile-1'), 1, 1),
  ('e0000000-0000-4000-8000-000000000002', 1, pg_temp.blob(64), pg_temp.h('profile-2'), 1, 1);
set local session_replication_role = origin;

select is(pg_temp.claim('k1', 'record-key', 'RECORDKEYONE'), 'received', 'a Record Key claim started');
create temporary table docs_k1 as select pg_temp.clean_document('k1', 'k1-photo', 'future-photo-identity') photo,
  pg_temp.clean_document('k1', 'k1-birth', 'future-birth-record') birth;
select is(public.complete_future_person_claim_v1(pg_temp.h('session:k1'), pg_temp.h('finish:k1'), 'record-key',
  (select photo from docs_k1), (select birth from docs_k1)), 'received', 'and completed');
select is((select case_kind || ':' || matched_embryo_id from private.claim_reviews where id = pg_temp.review_of('k1')),
  'record_key:e0000000-0000-4000-8000-000000000001', 'an eligible record is the record_key case');
select is(pg_temp.claim('k2', 'record-key', 'RECORDKEYTWO'), 'received', 'a claim on a record transferred 5 years ago');
create temporary table docs_k2 as select pg_temp.clean_document('k2', 'k2-photo', 'future-photo-identity') photo,
  pg_temp.clean_document('k2', 'k2-birth', 'future-birth-record') birth;
select is(public.complete_future_person_claim_v1(pg_temp.h('session:k2'), pg_temp.h('finish:k2'), 'record-key',
  (select photo from docs_k2), (select birth from docs_k2)), 'received',
  'is received the same way, so the claimant learns nothing');
select is((select case_kind from private.claim_reviews where id = pg_temp.review_of('k2')),
  'record_key_unmatched_or_ineligible', 'but no claimant can be adult yet, so it is ineligible');
select is(pg_temp.claim('k3', 'record-key', 'NOSUCHKEY'), 'received', 'a claim on a key that does not exist');
create temporary table docs_k3 as select pg_temp.clean_document('k3', 'k3-photo', 'future-photo-identity') photo,
  pg_temp.clean_document('k3', 'k3-birth', 'future-birth-record') birth;
select is(public.complete_future_person_claim_v1(pg_temp.h('session:k3'), pg_temp.h('finish:k3'), 'record-key',
  (select photo from docs_k3), (select birth from docs_k3)), 'received', 'is received the same way too');
select is((select case_kind from private.claim_reviews where id = pg_temp.review_of('k3')),
  'record_key_unmatched_or_ineligible', 'and is indistinguishable from the ineligible one');

-- Approving the eligible record queues the release decision.
create temporary table rk as select pg_temp.review_of('k1') id, (select photo from docs_k1) photo,
  (select birth from docs_k1) birth, pg_temp.h('dl:k1p') pc, pg_temp.h('dl:k1b') bc;
grant select on rk to authenticated;
select private.assign_claim_review_v1((select id from rk), '7e000000-0000-4000-8000-000000000002');
select pg_temp.jwt('7e000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000002');
set local role authenticated;
select is(public.read_claim_review_case_v1((select id from rk))->'allowedDecisions',
  '["approve-record-key", "reject", "needs-more-information"]'::jsonb, 'the record_key case allows approval');
select ok(public.read_claim_review_case_v1((select id from rk))->>'parentIdentityCiphertext' is not null,
  'and carries the recorded parent link, sealed, for the route to open');
create temporary table dk as select
  public.open_claim_review_download_v1((select photo from rk), (select pc from rk)) p,
  public.open_claim_review_download_v1((select birth from rk), (select bc from rk)) b;
reset role;
grant select on dk to authenticated;
set local role authenticated;
select ok(public.authorize_claim_review_chunk_v1((select (p->>'session')::uuid from dk), (select pc from rk), 0) ? 'objectKey',
  'photo read');
select ok(public.authorize_claim_review_chunk_v1((select (b->>'session')::uuid from dk), (select bc from rk), 0) ? 'objectKey',
  'birth record read');
select is(public.decide_claim_review_v1((select id from rk), 1, 'approve-record-key',
  encode(extensions.digest('k1-approve','sha256'),'hex'), (select r from reason))->>'state', 'release_queued',
  'approval records the release decision');
select throws_ok($$select public.decide_claim_review_v1((select id from rk), 2, 'reject',
  encode(extensions.digest('k1-late','sha256'),'hex'), (select r from reason))$$, '42501', null,
  'an approved case takes no further decision here');
select throws_ok($$select public.read_claim_review_case_v1((select id from rk))$$, '42501', null,
  'and is no longer read here: the release step reads it on its own terms');
reset role;
select is((select count(*) from public.legal_audit_log where event_code = 'claim.review.approved'), 1::bigint,
  'the ledger records the approval with no identifier');
select ok(exists (select 1 from private.claim_document_review_object_v1((select photo from rk))),
  'the approved case''s documents stay readable for the release step');

-- A second claim on the same record while this one is open is not eligible.
select is(pg_temp.claim('k4', 'record-key', 'RECORDKEYONE'), 'received', 'a second claim on the same record');
create temporary table docs_k4 as select pg_temp.clean_document('k4', 'k4-photo', 'future-photo-identity') photo,
  pg_temp.clean_document('k4', 'k4-birth', 'future-birth-record') birth;
select is(public.complete_future_person_claim_v1(pg_temp.h('session:k4'), pg_temp.h('finish:k4'), 'record-key',
  (select photo from docs_k4), (select birth from docs_k4)), 'received', 'is received');
select is((select case_kind from private.claim_reviews where id = pg_temp.review_of('k4')),
  'record_key_unmatched_or_ineligible', 'but conflicts with the open review and is ineligible');

-- ---------------------------------------------------------------------------
-- The deadline closes every open case without release, the approved one too.
update private.claim_reviews set created_at = created_at - interval '31 days', deadline = deadline - interval '31 days'
where id in ((select id from rk), pg_temp.review_of('k2'));
select is(public.close_due_claim_reviews_v1(), 2, 'two cases past their deadline close');
select is((select state from private.claim_reviews where id = (select id from rk)), 'closed',
  'the approved case closes without release');
select ok(not exists (select 1 from private.claim_document_review_object_v1((select photo from rk))),
  'and its documents are unreadable');
select ok((select object_key from private.claim_documents where id = (select photo from rk))
  in (select * from public.claim_document_objects_due_v1(1000)), 'and due for deletion');

-- Revoking a reviewer ends their assignments.
select private.revoke_claim_reviewer_v1('7e000000-0000-4000-8000-000000000002');
select is((select count(*) from private.claim_review_assignments
  where reviewer_account_id = '7e000000-0000-4000-8000-000000000002' and status = 'current'), 0::bigint,
  'a revoked reviewer holds no assignment');

-- ---------------------------------------------------------------------------
-- Capacity: an open review keeps its place in the global 500.
insert into private.future_person_claim_intakes (session_hash, form_nonce_hash, mode, key_hash,
 identity_ciphertext, wrapped_data_key, identifier_hmac, identifier_key_revision, network_hmac,
 network_key_revision, created_at, last_active_at, expires_at)
select pg_temp.h('bulk-s'||g), pg_temp.h('bulk-n'||g), 'keyless-start', null, pg_temp.blob(64), pg_temp.blob(60),
 pg_temp.h('bulk-i'||g), 1, pg_temp.h('bulk-net'||g), 1, now_at, now_at, now_at + interval '24 hours'
from generate_series(1, 500 - (select count(*) from private.future_person_claim_intakes i where private.claim_intake_live_v1(i))
  - (select count(*) from private.claim_reviews r where private.claim_review_open_v1(r))) g,
 (select clock_timestamp() now_at) t;
select is(pg_temp.claim('over'), 'capacity_limited', 'live intakes and open reviews together hold the 500');

-- ---------------------------------------------------------------------------
-- Privileges.
select ok(not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r,
  unnest(array['private.claim_reviewers', 'private.claim_reviews', 'private.claim_review_assignments',
    'private.claim_review_reads', 'private.claim_review_decisions', 'private.claim_review_downloads']) t
  where has_table_privilege(r, t, 'select') or has_table_privilege(r, t, 'insert')
    or has_table_privilege(r, t, 'update') or has_table_privilege(r, t, 'delete')),
  'no API role reads or writes a review table');
select ok(not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r,
  unnest(array['private.grant_claim_reviewer_v1(uuid)', 'private.revoke_claim_reviewer_v1(uuid)',
    'private.assign_claim_review_v1(uuid,uuid)']) f
  where has_function_privilege(r, f, 'execute')), 'no API role can name a reviewer or assign a case');
select ok(has_function_privilege('service_role', 'public.complete_future_person_claim_v1(text,text,text,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.complete_future_person_claim_v1(text,text,text,uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.complete_future_person_claim_v1(text,text,text,uuid,uuid)', 'execute'),
  'only the service role completes a claim');
select ok(not exists (select 1 from unnest(array['anon', 'service_role']) r,
  unnest(array['public.read_claim_review_case_v1(uuid)', 'public.open_claim_review_download_v1(uuid,text)',
    'public.authorize_claim_review_chunk_v1(uuid,text,integer)', 'public.decide_claim_review_v1(uuid,bigint,text,text,bytea)']) f
  where has_function_privilege(r, f, 'execute')), 'the reviewer doors are the reviewer''s JWT only, never the service role');
select is((select count(*) from public.purge_target_stores where store_name like 'private.claim_review%'), 5::bigint,
  'all five review stores are in the purge register');

select * from finish();
rollback;
