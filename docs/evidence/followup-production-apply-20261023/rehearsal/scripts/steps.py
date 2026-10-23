"""LOCAL ONLY step analysis of the 7 follow-up migrations on the relfu mirror (127.0.0.1:56322).

    python3 -I steps.py <outdir>

Precondition: the mirror holds PR 324's rehearsed post-state (build-mirror.sh --pr324),
and <outdir>/funcs-prod.json holds funcs.py's capture of the production state taken
before PR 324's batches. Applies the 7 migrations (77d04563 over 538dcee6) one at a
time, in filename order, each in its own transaction (psql -1 -f, the CLI's shape),
and records before and after each one: funcs.py's capture, the fingerprint.sql
read-back and the wall time. Writes steps.json. guards.py reads it.
"""
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import funcs  # noqa: E402

W = os.environ['RELFU_SCRATCH']
FP = os.environ.get('FP', '/home/user/wt-release3/docs/evidence/pr324-production-apply-20261022/fingerprint.sql')
DB = funcs.DB
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
env = funcs.ENV
base = set(os.listdir(f'{W}/src/pr324/supabase/migrations'))
files = sorted(f for f in os.listdir(f'{W}/src/fu/supabase/migrations') if f not in base)
assert len(files) == 7, files


def fingerprint(path):
    subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', FP, '-o', path], env=env, check=True)


ledger = subprocess.run(['psql', DB, '-X', '-At', '-c', "select count(*)||' '||max(version) from supabase_migrations.schema_migrations"],
                        env=env, check=True, capture_output=True, text=True).stdout.strip()
assert ledger == '273 20261016221000', ledger
before = funcs.capture()
json.dump(before, open(f'{OUT}/funcs-00-pr324.json', 'w'), sort_keys=True, indent=0)
fingerprint(f'{OUT}/fp-00-pr324.json')
report = []
for i, f in enumerate(files, 1):
    path = f'{W}/src/fu/supabase/migrations/{f}'
    t0 = time.monotonic()
    r = subprocess.run(['psql', DB, '-X', '-v', 'ON_ERROR_STOP=1', '-1', '-f', path], capture_output=True, text=True, env=env)
    dt = time.monotonic() - t0
    open(f'{OUT}/apply-{i:02d}.log', 'w').write(r.stdout + r.stderr)
    after = funcs.capture()
    json.dump(after, open(f'{OUT}/funcs-{i:02d}.json', 'w'), sort_keys=True, indent=0)
    fingerprint(f'{OUT}/fp-{i:02d}.json')
    report.append(dict(index=i, file=f, rc=r.returncode, seconds=round(dt, 3),
                       error=[l for l in (r.stdout + r.stderr).splitlines() if 'ERROR' in l][:3]))
    print(f'#{i:02d} {f} rc={r.returncode} {dt:.3f}s', flush=True)
    if r.returncode != 0:
        print('  ', report[-1]['error'])
        break
json.dump(report, open(f'{OUT}/steps.json', 'w'), indent=1)
