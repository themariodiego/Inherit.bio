"""LOCAL ONLY step analysis on the rel324 mirror (127.0.0.1:55322).

Applies the 25 PR 324 migrations one at a time, in filename order, each in its
own transaction (psql -1 -f), and records before/after every one:
  * md5(prosrc), owner, prosecdef, proconfig, proacl of every function outside
    pg_catalog/information_schema;
  * the full fingerprint.sql read-back;
  * the wall time of the migration.
Then maps every md5(prosrc)='<hash>' literal in each migration to the function(s)
holding that body just before the migration (predecessor) or just after it
(successor), and says whether the body is the production (pre-release) one.

    python3 -I steps.py <outdir>
"""
import json
import os
import re
import subprocess
import sys
import time

S = '/tmp/claude-0/-home-user-Inherit-bio/6541a88f-5423-5787-89b6-a4effe2d1864/scratchpad/rel324'
FP = '/home/user/wt-release2/docs/evidence/pr323-production-apply-20261016/fingerprint.sql'
DB = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
assert ':54322/' not in DB
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
env = dict(os.environ, PGCLIENTENCODING='UTF8')

main = set(os.listdir(f'{S}/src/main-supabase/migrations'))
files = sorted(f for f in os.listdir(f'{S}/src/head-supabase/migrations') if f not in main)
assert len(files) == 25, len(files)

FQ = r"""select coalesce(jsonb_object_agg(k, v), '{}') from (
 select n.nspname||'.'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')' k,
  jsonb_build_object('md5', md5(p.prosrc), 'owner', pg_catalog.pg_get_userbyid(p.proowner), 'secdef', p.prosecdef,
   'config', p.proconfig, 'acl', p.proacl::text, 'lang', l.lanname, 'oid', p.oid) v
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 join pg_catalog.pg_language l on l.oid = p.prolang
 where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%') s"""


def psql(*args, check=True):
    return subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', *args],
                          capture_output=True, text=True, env=env, check=check)


def funcs():
    return json.loads(psql('-c', FQ).stdout)


def fingerprint(path):
    psql('-f', FP, '-o', path)


GUARD = re.compile(r"md5\((?:p\.)?prosrc\)\s*=\s*'([0-9a-f]{32})'")
prod = funcs()
json.dump(prod, open(f'{OUT}/funcs-00-pre.json', 'w'), sort_keys=True)
fingerprint(f'{OUT}/fp-00-pre.json')
report = []
before = prod
for i, f in enumerate(files, 1):
    text = open(f'{S}/src/head-supabase/migrations/{f}', encoding='utf-8').read()
    t0 = time.monotonic()
    r = subprocess.run(['psql', DB, '-X', '-v', 'ON_ERROR_STOP=1', '-1', '-f', f'{S}/src/head-supabase/migrations/{f}'],
                       capture_output=True, text=True, env=env)
    dt = time.monotonic() - t0
    open(f'{OUT}/apply-{i:02d}.log', 'w').write(r.stdout + r.stderr)
    after = funcs()
    json.dump(after, open(f'{OUT}/funcs-{i:02d}.json', 'w'), sort_keys=True)
    fingerprint(f'{OUT}/fp-{i:02d}.json')
    by_md5_before, by_md5_after = {}, {}
    for k, v in before.items():
        by_md5_before.setdefault(v['md5'], []).append(k)
    for k, v in after.items():
        by_md5_after.setdefault(v['md5'], []).append(k)
    guards = []
    for m in GUARD.finditer(text):
        h = m.group(1)
        line = text.count('\n', 0, m.start()) + 1
        pre = by_md5_before.get(h, [])
        post = by_md5_after.get(h, [])
        role = 'predecessor' if pre else ('successor' if post else 'UNMATCHED')
        fns = pre or post
        origin = None
        if role == 'predecessor':
            origin = ['production' if prod.get(fn, {}).get('md5') == h else 'in-release' for fn in fns]
        guards.append(dict(line=line, md5=h, role=role, functions=fns, origin=origin))
    report.append(dict(index=i, file=f, rc=r.returncode, seconds=round(dt, 3), guards=guards,
                       error=[l for l in (r.stdout + r.stderr).splitlines() if 'ERROR' in l][:3]))
    print(f'#{i:02d} {f} rc={r.returncode} {dt:.3f}s guards={len(guards)}', flush=True)
    if r.returncode != 0:
        print('  ', report[-1]['error'])
        break
    before = after
json.dump(report, open(f'{OUT}/steps.json', 'w'), indent=1)
