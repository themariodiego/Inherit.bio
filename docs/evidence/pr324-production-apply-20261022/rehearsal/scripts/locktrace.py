"""LOCAL ONLY: which relation locks each of the 25 migrations adds, in one
transaction on the rel324 mirror, rolled back at the end (nothing persists).

    python3 -I locktrace.py <out.json>

Each migration runs through EXECUTE inside a DO block (as the batches run it),
then the backend's granted relation locks are read. A lock is attributed to the
first migration after which it appears; a stronger mode on the same relation is
recorded too. Pre-existing objects only (relations that existed before) are
flagged existing=true.
"""
import json
import os
import subprocess
import sys

S = '/tmp/claude-0/-home-user-Inherit-bio/6541a88f-5423-5787-89b6-a4effe2d1864/scratchpad/rel324'
DB = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
assert ':54322/' not in DB
main = set(os.listdir(f'{S}/src/main-supabase/migrations'))
files = sorted(f for f in os.listdir(f'{S}/src/head-supabase/migrations') if f not in main)
lines = ["\\set ON_ERROR_STOP 1", "begin;",
         "create temp table lt_existing as select c.oid from pg_class c;",
         "create temp table lt_out(step int, file text, seconds float8, locks jsonb);"]
LQ = ("(select coalesce(jsonb_agg(jsonb_build_array(n.nspname, c.relname, c.relkind::text, l.mode, "
      "exists(select 1 from lt_existing e where e.oid=c.oid)) order by n.nspname, c.relname, l.mode),'[]') "
      "from pg_locks l join pg_class c on c.oid=l.relation join pg_namespace n on n.oid=c.relnamespace "
      "where l.pid=pg_backend_pid() and l.locktype='relation' and l.granted and n.nspname not like 'pg_temp%' "
      "and n.nspname <> 'pg_catalog' and n.nspname not like 'pg_toast%')")
for i, f in enumerate(files, 1):
    text = open(f'{S}/src/head-supabase/migrations/{f}', encoding='utf-8').read()
    tag = f'$lt_{i:02d}$'
    assert tag not in text
    lines.append(f"do $o$ declare t0 timestamptz := clock_timestamp(); begin execute {tag}{text}{tag}; "
                 f"insert into lt_out values ({i}, '{f}', extract(epoch from clock_timestamp()-t0), {LQ}); end $o$;")
lines.append("\\o " + sys.argv[1] + ".raw")
lines.append("select jsonb_agg(jsonb_build_object('step',step,'file',file,'seconds',seconds,'locks',locks) order by step) from lt_out;")
lines.append("\\o")
lines.append("rollback;")
sql = '\n'.join(lines) + '\n'
open(f'{S}/logs/locktrace.sql', 'w', encoding='utf-8').write(sql)
r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-f', f'{S}/logs/locktrace.sql'], capture_output=True, text=True,
                   env=dict(os.environ, PGCLIENTENCODING='UTF8'))
if r.returncode:
    print(r.stdout[-2000:], r.stderr[-2000:])
    sys.exit(1)
steps = json.loads(open(sys.argv[1] + '.raw').read())
seen = {}
out = []
for s in steps:
    added = []
    for nsp, rel, kind, mode, existing in s['locks']:
        key = (nsp, rel, mode)
        if key not in seen:
            seen[key] = s['step']
            added.append(dict(rel=f'{nsp}.{rel}', kind=kind, mode=mode, existing=existing))
    out.append(dict(step=s['step'], file=s['file'], seconds=s['seconds'], new_locks=added))
json.dump(out, open(sys.argv[1], 'w'), indent=1)
STRONG = ('AccessExclusiveLock', 'ExclusiveLock', 'ShareRowExclusiveLock', 'ShareLock')
for s in out:
    ex = [f"{l['rel']}:{l['mode'].replace('Lock','')}" for l in s['new_locks'] if l['existing'] and l['mode'] in STRONG and l['kind'] in ('r', 'p')]
    print(f"#{s['step']:02d} {s['file'][:40]:40} {s['seconds']:.3f}s existing-table strong locks: {', '.join(ex) or '-'}")
print('total migration seconds', round(sum(s['seconds'] for s in out), 3))
