"""Measured per-migration changes to objects that exist in main (= production).

    python3 -I stepdiff.py <steps-dir>   ->  prints a report; writes step-main-changes.json

Inputs: fp-00-pre.json .. fp-25.json from steps.py (one fingerprint after each
migration on the production mirror). For every object present in fp-00 (the
production state) it reports, per step, what changed: function definition,
grants, config, security definer, or removal; table columns (added, removed,
type/nullability/default changed), constraints, indexes, triggers, policies,
ACL, RLS flags. Storage buckets/policies and extensions too.
"""
import json
import os
import sys

D = sys.argv[1]
names = json.load(open(os.path.join(D, 'steps.json')))
fps = [json.load(open(os.path.join(D, 'fp-00-pre.json')))] + \
      [json.load(open(os.path.join(D, f'fp-{i:02d}.json'))) for i in range(1, len(names) + 1)]


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
    # new overloads of an existing name
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
    newf = len(set(bf) - set(af))
    newt = len(set(bt) - set(at))
    out.append(dict(index=i, file=names[i - 1]['file'], new_functions=newf, new_tables=newt,
                    main_changes=[list(c) for c in ch]))
    print(f"#{i:02d} {names[i-1]['file']}: +{newf} functions, +{newt} tables, {len(ch)} changes to main objects")
    for c in ch:
        print('    ', c[0], c[1], '::', c[2][:300])
json.dump(out, open(os.path.join(D, 'step-main-changes.json'), 'w'), indent=1)
