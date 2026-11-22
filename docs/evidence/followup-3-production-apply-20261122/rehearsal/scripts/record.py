"""LOCAL ONLY: write the committed records of the step analysis from the scratch logs.

    python3 -I record.py <scratch logs dir> <rehearsal/data dir>

Writes step-changes.txt (stepdiff.py's report), notes-prechecks.tsv (steps.py's run of
each release-notes pre-check SELECT at its own state) and locktrace.txt (locktrace.py);
and, when the scratch logs hold them, the rehearsal's other records: rehearsal-results.tsv,
prechecks-on-mirror-pre.json, pgtap-summaries.txt, negatives.tsv, generator-negatives.txt,
mirror-builds.txt, final-pass.txt and equivalence.txt (each with a header line).
"""
import re
import json
import os
import sys

LOGS, D = sys.argv[1:3]
steps = json.load(open(os.path.join(LOGS, 'steps', 'steps.json')))
with open(os.path.join(D, 'step-changes.txt'), 'w') as f:
    f.write("# LOCAL ONLY step analysis (rehearsal/scripts/steps.py, stepdiff.py), isolated stack relk4 "
            "127.0.0.1:58322, 2026-11-22, on the mirror of release 3's post-state (mirror build 2): the 21 "
            "migrations read from tree d43b12a8, applied one by one in filename order with psql -1 -f. "
            f"Applied: {sum(s['rc'] == 0 for s in steps)} of {len(steps)}. Changes to objects that exist before this release:\n")
    f.write(open(os.path.join(LOGS, 'steps', 'stepdiff.txt')).read())
with open(os.path.join(D, 'notes-prechecks.tsv'), 'w') as f:
    f.write("# LOCAL ONLY: each section of docs/evidence/release-4-notes-20261119.md gives one read-only pre-check "
            "SELECT for the state just before its migration. rehearsal/scripts/steps.py ran each there (mirror build 2), "
            "then applied the migration with psql -1 -f. Columns: #, file, SELECT rc, must_be_* columns, those not holding, "
            "migration rc, seconds, how the SELECT was read from the notes, its context_* values.\n")
    for s in steps:
        n = s['notes_precheck']
        f.write('\t'.join([f"#{s['index']:02d}", s['file'], f"rc={n['rc']}", f"{n['must_be']} must_be_*",
                           'not holding: ' + (json.dumps(n['not_holding']) if n['not_holding'] else 'none'),
                           f"migration rc={s['rc']}", f"{s['seconds']}s", n['repaired'],
                           json.dumps(n['context'], sort_keys=True)]) + '\n')
lt = json.load(open(os.path.join(LOGS, 'analysis', 'locktrace.json')))
STRONG = ('AccessExclusiveLock', 'ExclusiveLock', 'ShareRowExclusiveLock', 'ShareLock', 'RowExclusiveLock',
          'ShareUpdateExclusiveLock')
with open(os.path.join(D, 'locktrace.txt'), 'w') as f:
    f.write("# LOCAL ONLY lock trace (rehearsal/scripts/locktrace.py 1 21), relk4, 2026-11-22: all 21 migrations in "
            "one transaction on the mirror of release 3's post-state, rolled back. A lock is attributed to the first "
            "migration after which it appears; only locks beyond ACCESS SHARE on tables that existed before are listed.\n")
    for s in lt:
        ex = [f"{l['rel']}:{l['mode'].replace('Lock', '')}" for l in s['new_locks']
              if l['existing'] and l['kind'] in ('r', 'p') and l['mode'] in STRONG]
        f.write(f"#{s['step']:02d} {s['file']} {s['seconds']:.3f}s: {', '.join(ex) or '-'}\n")
    f.write(f"total migration seconds {round(sum(s['seconds'] for s in lt), 3)}\n")


def put(name, header, body):
    with open(os.path.join(D, name), 'w') as f:
        f.write(header.rstrip('\n') + '\n' + body.rstrip('\n') + '\n')


def have(*p):
    return os.path.exists(os.path.join(LOGS, *p))


def text(*p):
    return open(os.path.join(LOGS, *p), encoding='utf-8').read()


STACK = 'isolated stack relk4 127.0.0.1:58322, 2026-11-22'
if have('rehearsal', 'results.tsv'):
    put('rehearsal-results.tsv', f"# LOCAL ONLY rehearsal (rehearsal/scripts/rehearse.sh, SUITES=1 OLDSUITE=1), {STACK}, on the mirror of "
        "release 3's post-state (mirror build 3). Files from generate.py final at head fe8c69d1 (tree d43b12a8); read-backs with "
        "check-readback.py; 'unchanged' = fingerprint and ledger byte-identical before and after.", text('rehearsal', 'results.tsv'))
    open(os.path.join(D, 'prechecks-on-mirror-pre.json'), 'w').write(text('rehearsal', 'prechecks-mirror-pre.json'))
    rows = [l for l in text('rehearsal', 'results.tsv').splitlines() if l.startswith('pgtap') or 'pgTAP suite' in l]
    pre = text('analysis', 'pgtap-release3-on-pre.log')
    summ = lambda s: ' '.join(re.findall(r'^(?:Files=.*?wallclock secs|Result: \w+)', s, re.M))
    final = text('rehearsal', 'pgtap-release3-on-final.log')
    rep = re.search(r'Test Summary Report\n-+\n(.*?)\nFiles=', final, re.S)
    rep = re.sub(r'/\S*/supabase/tests/', '', rep.group(1)) if rep else ''
    put('pgtap-summaries.txt', f"# LOCAL ONLY pgTAP runs, {STACK}. Every run left the fingerprint and ledger unchanged (pgTAP dropped after "
        "each). The 33 suites are the supabase/tests files the branch added or changed since release 3's tree (git diff a2a4d8e9 fe8c69d1), "
        "run from the pinned head on the final state; release 3's suite is 6252566a's whole supabase/tests.",
        "release 3's whole suite (6252566a) on the pre-state (mirror build 3, before batch 1): " + summ(pre) + '\n'
        + '\n'.join(rows) + '\n' + "release 3's whole suite on the final state, Test Summary Report:\n" + rep)
if have('negatives', 'results.tsv'):
    put('negatives.tsv', f"# LOCAL ONLY negative checks, {STACK}. Each in one rolled-back transaction (negatives.sh), or a statement that "
        "refuses (rehearse.sh, rehearsal-results.tsv 'neg' rows); state = fingerprint SHA-256 prefix and ledger before vs after. "
        "wrong-body-* and extra-grant on release 3's post-state (mirror build 6); missing-release-3 on release 2's post-state (mirror build 7), "
        "both with the revised pre-checks file. The first run of these (builds 4 and 5, with the pre-checks file the rehearsal used) gave the "
        "same refusals, except that on the missing-release state the pre-checks query itself failed (relation "
        "private.session_csrf_token_uses does not exist); the file was revised to answer there (README.md, 'Pre-check stop rules').",
        text('negatives', 'results.tsv') + '\n# From rehearse.sh:\n' + '\n'.join(
            l for l in text('rehearsal', 'results.tsv').splitlines() if l.startswith('neg') or '\tre-apply\t' in l))
if have('generator-negatives.txt'):
    put('generator-negatives.txt', "# LOCAL ONLY: generate.py refusals and acceptances (rehearsal/scripts/generator-negatives.sh), 2026-11-22, in a "
        "scratch clone (git clone --shared): the synthetic commits (no ref, parent fe8c69d1) exist only there.", text('generator-negatives.txt'))
if have('mirror-builds.txt'):
    put('mirror-builds.txt', f"# Builds of release 4's pre-state (rehearsal/scripts/build-mirror.sh), {STACK}. Build 1 fed the first step "
        "analysis, 2 the step analysis with the notes' pre-checks, 3 the pre-checks, the measurement and the rehearsal, 4 the tamper "
        "negatives and the final pass, 5 (STOP_AFTER=followup) the missing-release negative, 6 and 7 the same two negatives again "
        "with the revised pre-checks file.", text('mirror-builds.txt'))
if have('final-pass', 'final-pass.txt'):
    put('final-pass.txt', '# LOCAL ONLY: ' + STACK + '.', text('final-pass', 'final-pass.txt'))
if have('equivalence', 'equivalence.txt'):
    put('equivalence.txt', f"# Order equivalence (LOCAL ONLY, rehearsal/scripts/equivalence.sh), {STACK}. Fingerprint = ../../fingerprint.sql "
        "output; dumps = pg_dump 17 --schema-only, normalised by dropping its two random \\restrict/\\unrestrict lines. "
        "fp-mirror-final / dump-mirror-final: the rehearsed final mirror (rehearse.sh, after the four batches), saved before the resets.",
        text('equivalence', 'equivalence.txt'))
print('written')
