"""Rollback-only operational proof on the explicitly owned disposable local DB.
Never activates a scheduler or contacts hosted services. Exact job bytes are
used; transaction delimiters alone are omitted inside the rollback fixture.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OPS = ROOT / 'scripts/operations'
CONTAINER = 'supabase_db_inherit-family-20260907'


def run(sql):
    result = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-X',
                             '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
                            input=sql, text=True, capture_output=True, timeout=90)
    lines = [x for x in result.stdout.splitlines() if x.startswith(('ok ', 'not ok ', '1..'))]
    # Do not print arbitrary database errors, commands or fixture values.
    if result.returncode or any(x.startswith('not ok') for x in lines):
        print(json.dumps({'passed': False, 'exitCode': result.returncode, 'assertions': lines}))
        sys.exit(1)
    return lines


def inner(sql):
    start = sql.index('BEGIN;') + len('BEGIN;')
    end = sql.rindex('COMMIT;')
    return sql[start:end]


command = (OPS / 'retention-command.sql').read_text()
installer = (OPS / 'retention-install.sql').read_text()
assert installer.split('$command$')[1] == command
for name in ['activate', 'unschedule']:
    assert hashlib.md5(command.encode()).hexdigest() in (OPS / f'retention-{name}.sql').read_text()
assert command.index("SET LOCAL statement_timeout = '20s'") < command.index('DO $tick$')
assert command.index('SET LOCAL ROLE service_role') < command.index('DO $tick$')
assert command.count('public.run_own_report_purge_v1()') == 1

# Refuse an existing scheduler or eligible queue; this proof never adopts it.
preflight = """select jsonb_build_object('installed',exists(select 1 from pg_extension where extname='pg_cron'),
'queued',(select count(*) from public.worker_jobs w where kind='revoke_purge' and status='queued'
and not_before<=clock_timestamp() and attempts<max_attempts and
(computation_revision='own-report-revocation-v1' or (computation_revision='family-revoke-purge-v1'
and private.own_report_purge_scope_v1(source_binding_id)->>'accountId'=user_id::text
and private.own_report_purge_scope_v1(source_binding_id)->>'revokedAt' is not null))));"""
p = subprocess.run(['docker', 'exec', CONTAINER, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atc', preflight], capture_output=True, text=True, check=True)
state = json.loads(p.stdout)
if state != {'installed': False, 'queued': 0}:
    raise SystemExit('retention_proof_requires_empty_owned_scope')

install_do = installer[installer.index('DO $install$'):installer.index('$install$;') + len('$install$;')]
assertions = run("begin; create extension if not exists pgtap with schema extensions; set local search_path=public,extensions; select no_plan();\n" + inner(installer) + """
select is((select count(*) from cron.job where jobname='inherit-own-report-retention-15s-v1'),1::bigint,'one exact inactive job installed');
select ok((select not active from cron.job where jobname='inherit-own-report-retention-15s-v1'),'installation cannot activate');
create temporary table original_job as select jobid,command from cron.job where jobname='inherit-own-report-retention-15s-v1';
""" + inner(installer) + """
select ok((select j.jobid=o.jobid and j.command=o.command and not j.active from cron.job j join original_job o using(jobid)),'reinstallation preserves job identity and inactive state');
savepoint conflict;
select cron.alter_job(jobid,command=>'SELECT 1') from cron.job where jobname='inherit-own-report-retention-15s-v1';
""" + "select throws_ok($test$" + install_do + "$test$,'P0001','retention_job_conflict','conflicting command is refused');\nrollback to conflict;\n" + inner(command.split('-- Separate transaction:')[1]) + inner((OPS / 'retention-unschedule.sql').read_text()) + """
select is((select count(*) from cron.job where jobname='inherit-own-report-retention-15s-v1'),0::bigint,'recovery removes only matching inactive job');
select * from finish(); rollback;
""")

condition = command.split("IF jsonb_typeof(receipt)", 1)[1].split("THEN RAISE EXCEPTION 'retention_receipt_invalid';", 1)[0]
condition = 'jsonb_typeof(receipt)' + condition
validation = "begin; create extension if not exists pgtap with schema extensions; set local search_path=public,extensions; select no_plan();\n"
for value in ['null', '{}', '{"outcome":null,"deletedRows":0}', '{"outcome":2,"deletedRows":0}', '{"outcome":"complete","deletedRows":9007199254740992}', '{"outcome":"retry","deletedRows":1}']:
    check = "DO $validate$ DECLARE receipt jsonb := '" + value + "'::jsonb; BEGIN IF " + condition + " THEN RAISE EXCEPTION 'retention_receipt_invalid'; END IF; END; $validate$;"
    validation += "select throws_ok($case$" + check + "$case$,'P0001','retention_receipt_invalid','invalid closed receipt refuses');\n"
assertions += run(validation + "select * from finish(); rollback;")

fixture = (ROOT / 'supabase/tests/own_report_revocation_executor.sql').read_text()
end = fixture.index('select is(pg_temp.readable()')
setup = fixture[:end]
# Setup has genuine store consent, normalization, selected generation and a
# deliberately interrupted synchronous revoke leaving its real frozen job.
first_transaction = inner(command.split('-- Separate transaction:')[0])
for delayed in [False, True]:
    inject = ""
    if delayed:
        inject = """
create function pg_temp.slow_retention() returns trigger language plpgsql as $$
begin
 if old.file_id='76900000-0000-4000-8000-000000000040'::uuid then
   if current_user<>'postgres' then raise exception 'unexpected_definer_role'; end if;
   perform pg_sleep(21);
 end if;
 return old;
end $$;
create trigger synthetic_retention_delay before delete on private.own_analysis_runs for each row execute function pg_temp.slow_retention();
"""
    checks = """
select ok((select count(*)=0 from private.own_analysis_runs where file_id='76900000-0000-4000-8000-000000000040'),'scheduled command deletes real revoked journal');
select ok((select count(*)=0 from public.user_prs where file_id='76900000-0000-4000-8000-000000000040'),'scheduled command deletes actual revoked result');
select ok(exists(select 1 from public.worker_jobs w join public.retention_due_phases d on d.retention_row_id=w.source_binding_id where w.user_id='76900000-0000-4000-8000-000000000001' and w.computation_revision='own-report-revocation-v1' and d.status='succeeded'),'actual completed disposition uses succeeded');
select is((select count(*) from public.worker_jobs w join public.retention_due_phases d on d.retention_row_id=w.source_binding_id where w.user_id='76900000-0000-4000-8000-000000000001' and w.computation_revision='own-report-revocation-v1' and d.status NOT IN ('succeeded','cancelled')),0::bigint,'completed disposition is excluded from incomplete observation');
""" if not delayed else """
select ok((select count(*)=1 from private.own_analysis_runs where file_id='76900000-0000-4000-8000-000000000040'),'timeout preserves rolled-back physical data');
select ok(exists(select 1 from public.worker_jobs where user_id='76900000-0000-4000-8000-000000000001' and computation_revision='own-report-revocation-v1' and status='queued' and error='own_report_purge_retry' and attempts=1),'swallowed real statement timeout commits one retry and stops');
"""
    assertions += run(setup + inject + first_transaction + "\nRESET ROLE; SET LOCAL statement_timeout='10s'; SET LOCAL search_path=public,extensions;\n" + checks + """
select is((select count(*) from public.report_observed_calls where file_id='76900000-0000-4000-8000-000000000040'),1::bigint,'raw observed source survives');
select is((select count(*) from storage.objects where name='76900000-0000-4000-8000-000000000030'),1::bigint,'original Storage metadata survives');
select * from finish(); rollback;
""")

p = subprocess.run(['docker', 'exec', CONTAINER, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atc', preflight], capture_output=True, text=True, check=True)
assert json.loads(p.stdout) == state
print(json.dumps({'passed': True, 'assertions': assertions, 'count': sum(x.startswith('ok ') for x in assertions), 'schedulerActivated': False, 'extensionPersisted': False, 'queuedScopePreserved': True, 'commandMd5': hashlib.md5(command.encode()).hexdigest()}))
