"""LOCAL ONLY step analysis of release 4's 21 migrations on the relk4 mirror.

    python3 -I steps.py <outdir>

Precondition: the mirror holds release 3's rehearsed post-state
(build-mirror.sh: ledger 284 rows, max 20261025400000). Applies the 21 migrations
(the files the pinned tree adds over release 3's tree be49d283), one at a time, in filename order, each
in its own transaction (psql -1 -f, the CLI's shape), read byte for byte from the pinned
tree (kitgit.py), and records before and after each one: funcs.py's capture,
the fingerprint.sql read-back, the wall time and the first error lines; and, before
each one, the read-only pre-check SELECT the release notes give for it (notes.py),
every must_be_* column checked against its rule, at the state that section was written
for. Stops at the
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
import notes  # noqa: E402

FP = os.path.join(kitgit.TOP, 'docs/evidence/followup-3-production-apply-20261122/fingerprint.sql')
EXPECT_LEDGER = os.environ.get('STEPS_LEDGER', '284 20261025400000')
DB = funcs.DB
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
env = funcs.ENV
files = kitgit.release_files()
note_sql = notes.sections()


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
    nq = f'{OUT}/notes-precheck-{i:02d}.sql'
    open(nq, 'w', encoding='utf-8').write(notes.wrap(note_sql[i]['sql']))
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', nq], capture_output=True, text=True, env=env)
    got = json.loads(r.stdout) if r.returncode == 0 else {}
    bad = {k: v for k, v in got.items() if notes.rule(k) is not None and v != notes.rule(k)}
    musts = [k for k in got if notes.rule(k) is not None]
    nres = dict(rc=r.returncode, error=r.stderr.strip()[:300], must_be=len(musts), not_holding=bad,
                context={k: v for k, v in got.items() if notes.rule(k) is None}, repaired=note_sql[i]['note'])
    print(f"   notes pre-check #{i:02d}: rc={r.returncode} {len(musts)} must_be_* columns, not holding: {bad or 'none'}", flush=True)
    src = f'{OUT}/m{i:02d}.sql'
    open(src, 'wb').write(data)
    t0 = time.monotonic()
    r = subprocess.run(['psql', DB, '-X', '-v', 'ON_ERROR_STOP=1', '-1', '-f', src], capture_output=True, text=True, env=env)
    dt = time.monotonic() - t0
    open(f'{OUT}/apply-{i:02d}.log', 'w').write(r.stdout + r.stderr)
    after = funcs.capture()
    json.dump(after, open(f'{OUT}/funcs-{i:02d}.json', 'w'), sort_keys=True, indent=0)
    fingerprint(f'{OUT}/fp-{i:02d}.json')
    report.append(dict(index=i, file=f, rc=r.returncode, seconds=round(dt, 3), notes_precheck=nres,
                       error=[l for l in (r.stdout + r.stderr).splitlines() if 'ERROR' in l or 'CONTEXT' in l][:3]))
    print(f'#{i:02d} {f} rc={r.returncode} {dt:.3f}s', flush=True)
    if r.returncode != 0:
        print('  ', report[-1]['error'])
        break
json.dump(report, open(f'{OUT}/steps.json', 'w'), indent=1)
