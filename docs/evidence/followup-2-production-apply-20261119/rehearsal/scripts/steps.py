"""LOCAL ONLY step analysis of this release's 4 migrations on the local mirror.

    python3 -I steps.py <outdir>

Precondition: the mirror holds the follow-up kit's rehearsed post-state
(build-mirror.sh: ledger 280 rows, max 20261023140000). Applies the 4 migrations
(the files the pinned tree adds over 77d04563's), one at a time, in filename order, each
in its own transaction (psql -1 -f, the CLI's shape), read byte for byte from the pinned
tree (kitgit.py), and records before and after each one: funcs.py's capture,
the fingerprint.sql read-back, the wall time and the first error lines. Stops at the
first file that fails. Writes steps.json; stepdiff.py and guards.py read it.
"""
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import funcs  # noqa: E402

import kitgit  # noqa: E402

FP = os.path.join(kitgit.TOP, 'docs/evidence/followup-2-production-apply-20261119/fingerprint.sql')
EXPECT_LEDGER = os.environ.get('STEPS_LEDGER', '280 20261023140000')
DB = funcs.DB
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
env = funcs.ENV
files = kitgit.release_files()


def fingerprint(path):
    subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', FP, '-o', path], env=env, check=True)


ledger = subprocess.run(['psql', DB, '-X', '-At', '-c', "select count(*)||' '||max(version) from supabase_migrations.schema_migrations"],
                        env=env, check=True, capture_output=True, text=True).stdout.strip()
assert ledger == EXPECT_LEDGER, ledger
before = funcs.capture()
json.dump(before, open(f'{OUT}/funcs-00-pre.json', 'w'), sort_keys=True, indent=0)
fingerprint(f'{OUT}/fp-00-pre.json')
report = []
for i, (f, data) in enumerate(files, 1):
    src = f'{OUT}/m{i:02d}.sql'
    open(src, 'wb').write(data)
    t0 = time.monotonic()
    r = subprocess.run(['psql', DB, '-X', '-v', 'ON_ERROR_STOP=1', '-1', '-f', src], capture_output=True, text=True, env=env)
    dt = time.monotonic() - t0
    open(f'{OUT}/apply-{i:02d}.log', 'w').write(r.stdout + r.stderr)
    after = funcs.capture()
    json.dump(after, open(f'{OUT}/funcs-{i:02d}.json', 'w'), sort_keys=True, indent=0)
    fingerprint(f'{OUT}/fp-{i:02d}.json')
    report.append(dict(index=i, file=f, rc=r.returncode, seconds=round(dt, 3),
                       error=[l for l in (r.stdout + r.stderr).splitlines() if 'ERROR' in l or 'CONTEXT' in l][:3]))
    print(f'#{i:02d} {f} rc={r.returncode} {dt:.3f}s', flush=True)
    if r.returncode != 0:
        print('  ', report[-1]['error'])
        break
json.dump(report, open(f'{OUT}/steps.json', 'w'), indent=1)
