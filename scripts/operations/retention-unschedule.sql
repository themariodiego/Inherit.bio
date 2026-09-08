-- Explicit operator unschedule; only the exact reviewed named job is eligible.
-- Unscheduling does not cancel an in-flight run or erase its obligations.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $operation$
DECLARE j cron.job%rowtype; expected_command text;
BEGIN
  IF current_user<>'postgres' OR current_database()<>'postgres' THEN RAISE EXCEPTION 'retention_operator_context_invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('inherit-own-report-retention-15s-v1',0));
  IF (SELECT count(*) FROM cron.job WHERE jobname='inherit-own-report-retention-15s-v1')>1 THEN RAISE EXCEPTION 'retention_job_conflict'; END IF;
  SELECT * INTO j FROM cron.job WHERE jobname='inherit-own-report-retention-15s-v1';
  IF NOT FOUND THEN RETURN; END IF;
  IF md5(j.command)<>'6a41c1ced21e1bf730db77220420b11e' THEN RAISE EXCEPTION 'retention_job_conflict'; END IF;
  expected_command:=j.command;
  IF j.command IS DISTINCT FROM expected_command OR j.schedule<>'15 seconds'
    OR j.username<>'postgres' OR j.database<>current_database()
    OR j.nodename IS DISTINCT FROM current_setting('cron.host') OR j.nodeport<>inet_server_port()
  THEN RAISE EXCEPTION 'retention_job_conflict'; END IF;
  PERFORM cron.unschedule(j.jobid);
END;
$operation$;
COMMIT;
