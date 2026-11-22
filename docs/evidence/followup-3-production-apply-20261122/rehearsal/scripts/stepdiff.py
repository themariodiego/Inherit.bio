"""Measured per-migration changes to objects that exist before this release.

    python3 -I stepdiff.py <steps-dir>   ->  prints a report; writes step-changes.json

Release 3's stepdiff.py, for release 4's steps. Inputs: fp-00-pre.json (release 3's
rehearsed post-state) and fp-NN.json from steps.py, one fingerprint after each
migration that applied. For every object present in fp-00 it reports, per step, what
changed: function definition, grants, config, security definer, or removal; table
columns, constraints, indexes, triggers, policies, ACL, RLS flags; storage buckets and
policies, extensions and the other categories.
"""
import json
import os
import sys

D = sys.argv[1]
steps = json.load(open(os.path.join(D, 'steps.json')))
applied = [s for s in steps if s['rc'] == 0]
fps = [json.load(open(os.path.join(D, 'fp-00-pre.json')))] + \
      [json.load(open(os.path.join(D, f"fp-{s['index']:02d}.json"))) for s in applied]


def fkey(f):
    return f"{f['schema']}.{f['name']}({f['args']})"


def tkey(t):
    return f"{t['schema']}.{t['name']}"


base_f = {fkey(f) for f in fps[0]['functions']}
base_t = {tkey(t) for t in fps[0]['tables']}
base_fnames = {(f['schema'], f['name']) for f in fps[0]['functions']}
out = []
for i in range(1, len(fps)):
    a, b = fps[i - 1], fps[i]
    ch = []
    af = {fkey(f): f for f in a['functions']}
    bf = {fkey(f): f for f in b['functions']}
    for k in sorted(base_f):
        x, y = af.get(k), bf.get(k)
        if x is None and y is None:
            continue
        if y is None:
            ch.append(('function', k, 'REMOVED'))
            continue
        if x is None:
            ch.append(('function', k, 'RE-CREATED'))
            continue
        d = [f for f in ('def_md5', 'proacl', 'proconfig', 'prosecdef', 'kind') if x[f] != y[f]]
        if d:
            det = {f: (x[f], y[f]) for f in d if f != 'def_md5'}
            ch.append(('function', k, ','.join(d) + (' ' + json.dumps(det) if det else '')))
    for k in sorted(set(bf) - set(af)):
        f = bf[k]
        if (f['schema'], f['name']) in base_fnames:
            ch.append(('function', k, 'NEW OVERLOAD of an existing name'))
    at = {tkey(t): t for t in a['tables']}
    bt = {tkey(t): t for t in b['tables']}
    for k in sorted(base_t):
        x, y = at.get(k), bt.get(k)
        if y is None:
            if x is not None:
                ch.append(('table', k, 'REMOVED'))
            continue
        for part in ('columns', 'constraints', 'indexes', 'triggers', 'policies'):
            xs = {json.dumps(v) for v in x[part]}
            ys = {json.dumps(v) for v in y[part]}
            if xs != ys:
                xn = {json.loads(v)[0]: v for v in xs}
                yn = {json.loads(v)[0]: v for v in ys}
                added = sorted(set(yn) - set(xn))
                removed = sorted(set(xn) - set(yn))
                changed = sorted(n for n in set(xn) & set(yn) if xn[n] != yn[n])
                det = []
                if added: det.append('+' + ','.join(added))
                if removed: det.append('-' + ','.join(removed))
                if changed: det.append('~' + ','.join(changed))
                ch.append(('table', k, f'{part}: ' + ' '.join(det)))
        for f in ('relacl', 'relrowsecurity', 'relforcerowsecurity'):
            if x[f] != y[f]:
                ch.append(('table', k, f'{f}: {x[f]} -> {y[f]}'))
    for cat in ('storage_buckets', 'storage_policies', 'extensions', 'schema_acls', 'types', 'views', 'sequences'):
        if a[cat] != b[cat]:
            xs = {json.dumps(v, sort_keys=True) for v in a[cat]}
            ys = {json.dumps(v, sort_keys=True) for v in b[cat]}
            ch.append((cat, '', f'+{len(ys - xs)} -{len(xs - ys)} ' + ' | '.join(sorted(ys - xs))[:400]))
    newf = sorted(set(bf) - set(af))
    newt = sorted(set(bt) - set(at))
    s = applied[i - 1]
    out.append(dict(index=s['index'], file=s['file'], new_functions=newf, new_tables=newt,
                    changes=[list(c) for c in ch]))
    print(f"#{s['index']:02d} {s['file']}: +{len(newf)} functions, +{len(newt)} tables, {len(ch)} changes to existing objects")
    for n in newf:
        print('     new function', n, bf[n]['proacl'])
    for n in newt:
        t = bt[n]
        print('     new table', n, 'rls', t['relrowsecurity'], 'acl', t['relacl'])
    for c in ch:
        print('    ', c[0], c[1], '::', c[2][:300])
for s in steps:
    if s['rc'] != 0:
        print(f"#{s['index']:02d} {s['file']}: rc {s['rc']}, not applied: {' | '.join(s['error'])}")
json.dump(out, open(os.path.join(D, 'step-changes.json'), 'w'), indent=1)
