"""LOCAL ONLY: which relation locks each of this release's migrations adds, in one
transaction on the isolated stack relk4, rolled back at the end (nothing persists).
Release 3's locktrace.py, for release 4's 21 files. The caller exports PGPASSWORD.

    python3 -I locktrace.py <out.json> <first> <last>

Runs migrations #first..#last (1-based, filename order) through EXECUTE inside DO
blocks (as the batches run them), and after each reads the backend's granted relation
locks. A lock is attributed to the first migration after which it appears.
Relations that existed before the transaction are flagged existing=true.
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kitgit  # noqa: E402
DB = 'postgresql://postgres@127.0.0.1:58322/postgres'
files = kitgit.release_files()
out_path, first, last = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
lines = ["\\set ON_ERROR_STOP 1", "begin;",
         "create temp table lt_existing as select c.oid from pg_class c;",
         "create temp table lt_out(step int, file text, seconds float8, locks jsonb);"]
LQ = ("(select coalesce(jsonb_agg(jsonb_build_array(n.nspname, c.relname, c.relkind::text, l.mode, "
      "exists(select 1 from lt_existing e where e.oid=c.oid)) order by n.nspname, c.relname, l.mode),'[]') "
      "from pg_locks l join pg_class c on c.oid=l.relation join pg_namespace n on n.oid=c.relnamespace "
      "where l.pid=pg_backend_pid() and l.locktype='relation' and l.granted and n.nspname not like 'pg_temp%' "
      "and n.nspname <> 'pg_catalog' and n.nspname not like 'pg_toast%')")
for i in range(first, last + 1):
    f, data = files[i - 1]
    text = data.decode('utf-8')
    tag = f'$lt_{i:02d}$'
    assert tag not in text
    lines.append(f"do $o$ declare t0 timestamptz := clock_timestamp(); begin execute {tag}{text}{tag}; "
                 f"insert into lt_out values ({i}, '{os.path.basename(f)}', extract(epoch from clock_timestamp()-t0), {LQ}); end $o$;")
lines += ["\\o " + out_path + ".raw",
          "select jsonb_agg(jsonb_build_object('step',step,'file',file,'seconds',seconds,'locks',locks) order by step) from lt_out;",
          "\\o", "rollback;"]
sqlp = out_path + '.sql'
open(sqlp, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-f', sqlp], capture_output=True, text=True,
                   env=dict(os.environ, PGCLIENTENCODING='UTF8'))
if r.returncode:
    print(r.stdout[-2000:], r.stderr[-2000:])
    sys.exit(1)
steps = json.loads(open(out_path + '.raw').read())
seen, out = {}, []
for s in steps:
    added = []
    for nsp, rel, kind, mode, existing in s['locks']:
        key = (nsp, rel, mode)
        if key not in seen:
            seen[key] = s['step']
            added.append(dict(rel=f'{nsp}.{rel}', kind=kind, mode=mode, existing=existing))
    out.append(dict(step=s['step'], file=s['file'], seconds=s['seconds'], new_locks=added))
json.dump(out, open(out_path, 'w'), indent=1)
STRONG = ('AccessExclusiveLock', 'ExclusiveLock', 'ShareRowExclusiveLock', 'ShareLock')
for s in out:
    ex = [f"{l['rel']}:{l['mode'].replace('Lock','')}" for l in s['new_locks'] if l['existing'] and l['kind'] in ('r', 'p', 'v')]
    strong = [f"{l['rel']}:{l['mode'].replace('Lock','')}" for l in s['new_locks'] if l['existing'] and l['kind'] in ('r', 'p') and l['mode'] in STRONG]
    print(f"#{s['step']:02d} {s['file'][:52]:52} {s['seconds']:.3f}s locks on existing relations first taken here: {', '.join(ex) or '-'}; strong: {', '.join(strong) or '-'}")
print('total migration seconds', round(sum(s['seconds'] for s in out), 3))
