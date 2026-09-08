-- Operator-only installation. Review aggregate due scope and deployed canonical
-- compatibility first. Creates an INACTIVE job; run retention-activate separately.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';
DO $preflight$
BEGIN
  IF current_user<>'postgres' OR current_database()<>'postgres'
    OR NOT 'pg_cron'=ANY(string_to_array(replace(current_setting('shared_preload_libraries'),' ',''),','))
    OR NOT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pg_cron')
    OR to_regprocedure('public.run_own_report_purge_v1()') IS NULL
  THEN RAISE EXCEPTION 'retention_prerequisite_unavailable'; END IF;
  IF NOT has_function_privilege('service_role','public.run_own_report_purge_v1()','EXECUTE')
    OR has_function_privilege('anon','public.run_own_report_purge_v1()','EXECUTE')
    OR has_function_privilege('authenticated','public.run_own_report_purge_v1()','EXECUTE')
    OR has_function_privilege('inherit_upload_only','public.run_own_report_purge_v1()','EXECUTE')
  THEN RAISE EXCEPTION 'retention_executor_acl_invalid'; END IF;
END;
$preflight$;
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $install$
DECLARE j cron.job%rowtype; new_id bigint;
  expected_command text := $command$BEGIN;
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
$command$;
BEGIN
  IF current_user<>'postgres' OR current_database()<>'postgres' THEN RAISE EXCEPTION 'retention_operator_context_invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('inherit-own-report-retention-15s-v1',0));
  IF (SELECT split_part(extversion,'.',1)::integer*100+split_part(extversion,'.',2)::integer FROM pg_extension WHERE extname='pg_cron')<106
  THEN RAISE EXCEPTION 'retention_seconds_unavailable'; END IF;
  IF current_setting('cron.database_name') IS DISTINCT FROM current_database()
    OR current_setting('cron.log_run') IS DISTINCT FROM 'on'
  THEN RAISE EXCEPTION 'retention_cron_config_unavailable'; END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname='inherit-own-report-retention-15s-v1')>1 THEN RAISE EXCEPTION 'retention_job_conflict'; END IF;
  SELECT * INTO j FROM cron.job WHERE jobname='inherit-own-report-retention-15s-v1';
  IF FOUND THEN
  IF j.command IS DISTINCT FROM expected_command OR j.schedule<>'15 seconds'
    OR j.username<>'postgres' OR j.database<>current_database()
    OR j.nodename IS DISTINCT FROM current_setting('cron.host') OR j.nodeport<>inet_server_port()
  THEN RAISE EXCEPTION 'retention_job_conflict'; END IF;
    RETURN; -- Exact existing active or inactive state is preserved.
  END IF;
  new_id := cron.schedule('inherit-own-report-retention-15s-v1','15 seconds',expected_command);
  PERFORM cron.alter_job(new_id,active=>false);
END;
$install$;
COMMIT;
