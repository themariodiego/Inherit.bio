-- Read-only bounded operational evidence; no commands, payloads or error text.
BEGIN READ ONLY;
SELECT clock_timestamp() AS observed_at, jobid, schedule, active, database, username,
 md5(command) AS command_md5
FROM cron.job WHERE jobname='inherit-own-report-retention-15s-v1';
WITH recent AS (
 SELECT r.runid,r.status,r.start_time,r.end_time
 FROM cron.job_run_details r JOIN cron.job j USING(jobid)
 WHERE j.jobname='inherit-own-report-retention-15s-v1'
 ORDER BY r.runid DESC LIMIT 100
)
SELECT runid,status,start_time,end_time,
 extract(epoch FROM end_time-start_time) AS duration_seconds,
 extract(epoch FROM start_time-lag(start_time) OVER(ORDER BY runid)) AS start_gap_seconds
FROM recent ORDER BY runid DESC;
SELECT count(*) FILTER(WHERE w.status='queued') AS queued,
 min(w.created_at) FILTER(WHERE w.status='queued') AS oldest_created_at,
 count(*) FILTER(WHERE w.status='failed' AND w.result->>'cleanupComplete' IS DISTINCT FROM 'true') AS failed_incomplete,
 count(*) FILTER(WHERE d.phase_deadline<clock_timestamp() AND d.status NOT IN ('succeeded','cancelled')) AS overdue_immutable_dispositions,
 min(d.phase_deadline) FILTER(WHERE d.status NOT IN ('succeeded','cancelled')) AS earliest_incomplete_deadline
FROM public.worker_jobs w LEFT JOIN public.retention_due_phases d
 ON d.retention_row_id=w.source_binding_id AND d.retention_id='purpose.derived-60s'
WHERE w.kind='revoke_purge' AND w.computation_revision='own-report-revocation-v1';
-- Historical self candidates and exact immutable deadlines use the reviewed
-- composite inventory/manifest receipt. The above age is only an alert metric.
ROLLBACK;
