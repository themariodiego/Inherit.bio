-- D-085: `embryo-closed-schema-v1` asks for "exactly one pseudonymized legal
-- audit event for the whole blocked attempt, with a server-coded registered
-- consumer and shape reference, and never key names, values, target IDs or
-- payload fragments". These assertions are that sentence, clause by clause.
begin;
select plan(8);

-- Existing migration audit events remain untouched. Count only this attempt.
create temporary table blocked_audit_start as select coalesce(max(seq),0) seq from public.legal_audit_log;
-- One blocked attempt, one row.
select is(
  (select count(*) from public.legal_audit_log where event_code = 'embryo.response.blocked' and seq > (select seq from blocked_audit_start)),
  0::bigint,
  'this attempt has no blocked-response event before recording'
);
select lives_ok(
  $$select public.record_blocked_embryo_response_v1('api.embryo-record-key-cards')$$,
  'a registered consumer records the blocked attempt'
);
select is(
  (select count(*) from public.legal_audit_log where event_code = 'embryo.response.blocked' and seq > (select seq from blocked_audit_start)),
  1::bigint,
  'exactly one event, for the whole attempt'
);

-- The consumer and the shape reference, and nothing else.
select is(
  (select route_id from public.legal_audit_log where event_code = 'embryo.response.blocked' and seq > (select seq from blocked_audit_start)),
  'api.embryo-record-key-cards',
  'the row names the registered consumer'
);
select is(
  (select coded_context from public.legal_audit_log where event_code = 'embryo.response.blocked' and seq > (select seq from blocked_audit_start)),
  '{"shape_reference": "embryo-closed-schema-v1"}'::jsonb,
  'the coded context is the shape reference and nothing else'
);
select ok(
  (select audit_principal_id is null from public.legal_audit_log
   where event_code = 'embryo.response.blocked' and seq > (select seq from blocked_audit_start)),
  'the event is pseudonymized: it binds no principal'
);

-- A payload fragment cannot reach the ledger even if a caller passes one.
-- The route replaces it too; this proves the database does not rely on that.
select lives_ok(
  $$select public.record_blocked_embryo_response_v1('record_key=0123456789ABCDEFGHJK {sex: unknown}')$$,
  'an unregistered consumer still records the attempt rather than losing it'
);
select is(
  (select route_id from public.legal_audit_log
   where event_code = 'embryo.response.blocked' and seq > (select seq from blocked_audit_start) order by seq desc limit 1),
  'unregistered',
  'the fragment is replaced, not stored'
);

select * from finish();
rollback;
