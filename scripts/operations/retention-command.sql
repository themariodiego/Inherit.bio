BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '5s';
SET LOCAL application_name = 'inherit-own-retention-15s';
SET LOCAL ROLE service_role;
DO $tick$
DECLARE
  receipt jsonb;
  outcome text := 'idle';
  processed integer := 0;
  stop_at timestamptz := statement_timestamp() + interval '20 seconds';
BEGIN
  IF current_user <> 'service_role' OR current_setting('statement_timeout') <> '20s'
    OR current_setting('lock_timeout') <> '2s' THEN
    RAISE EXCEPTION 'retention_execution_context_invalid';
  END IF;
  FOR step IN 1..5 LOOP
    IF clock_timestamp() >= stop_at THEN outcome := 'budget'; EXIT; END IF;
    receipt := public.run_own_report_purge_v1();
    IF receipt IS NULL THEN outcome := 'idle'; EXIT; END IF;
    IF jsonb_typeof(receipt) IS DISTINCT FROM 'object'
      OR receipt - ARRAY['outcome','deletedRows'] <> '{}'::jsonb
      OR NOT receipt ?& ARRAY['outcome','deletedRows']
      OR jsonb_typeof(receipt->'outcome') IS DISTINCT FROM 'string'
      OR receipt->>'outcome' NOT IN ('complete','superseded','retry','blocked')
      OR jsonb_typeof(receipt->'deletedRows') IS DISTINCT FROM 'number'
      OR (receipt->>'deletedRows') !~ '^[0-9]+$'
      OR (receipt->>'deletedRows')::numeric > 9007199254740991
      OR (receipt->>'outcome' <> 'complete' AND (receipt->>'deletedRows')::numeric <> 0)
    THEN RAISE EXCEPTION 'retention_receipt_invalid'; END IF;
    outcome := receipt->>'outcome';
    -- The dispatcher can swallow statement cancellation and return retry.
    -- Never make another call after retry/blocked or after the active budget.
    IF outcome IN ('retry','blocked') THEN EXIT; END IF;
    IF outcome = 'complete' THEN processed := processed + 1; END IF;
    IF clock_timestamp() >= stop_at THEN outcome := 'budget'; EXIT; END IF;
  END LOOP;
  -- Fixed vocabulary/count only. No job IDs, payloads, SQLSTATE or exception text.
  RAISE WARNING 'inherit_retention_tick outcome=% processed=%', outcome, processed;
EXCEPTION WHEN query_canceled OR OTHERS THEN
  RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='retention_tick_failed';
END;
$tick$;
COMMIT;
-- Separate transaction: failure to prune our own operational logs cannot undo
-- a committed purge. Never delete another job's history or product/audit rows.
BEGIN;
SET LOCAL statement_timeout = '2s';
SET LOCAL lock_timeout = '1s';
DELETE FROM cron.job_run_details
WHERE runid IN (
  SELECT r.runid FROM cron.job_run_details r JOIN cron.job j USING(jobid)
  WHERE j.jobname='inherit-own-report-retention-15s-v1'
    AND j.username='postgres' AND j.database=current_database()
    AND r.end_time < clock_timestamp()-interval '1 day'
  ORDER BY r.runid LIMIT 200
);
COMMIT;
