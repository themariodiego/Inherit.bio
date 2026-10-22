"""Compare two fingerprint.sql read-backs object for object.

    python3 -I fpcompare.py <a.json> <b.json> [--allow-category-diff]

The production read-backs went through the Management API's JSON, which renders
sequence bounds as doubles (9223372036854775807 -> 9223372036854776000). Integers
are therefore compared after a float round-trip; everything else exactly. The
summary (computed server-side, exact) must be equal. Exits 1 on any difference.
"""
import json
import sys


def norm(x):
    if isinstance(x, bool) or x is None or isinstance(x, str):
        return x
    if isinstance(x, (int, float)):
        return float(x)
    if isinstance(x, list):
        return [norm(v) for v in x]
    if isinstance(x, dict):
        return {k: norm(v) for k, v in x.items()}
    return x


a, b = (json.load(open(p)) for p in sys.argv[1:3])
bad = 0
for k in sorted(set(a) | set(b)):
    if k == 'summary':
        continue
    na = [json.dumps(norm(x), sort_keys=True) for x in a.get(k, [])]
    nb = [json.dumps(norm(x), sort_keys=True) for x in b.get(k, [])]
    if na == nb:
        print(f'{k}: equal ({len(na)})')
        continue
    bad += 1
    sa, sb = set(na), set(nb)
    print(f'{k}: DIFFERENT (only first {len(sa - sb)}, only second {len(sb - sa)})')
    for x in sorted(sa - sb)[:20]:
        print('  <', x[:300])
    for x in sorted(sb - sa)[:20]:
        print('  >', x[:300])
if a['summary'] == b['summary']:
    print('summary: equal')
else:
    bad += 1
    for k in sorted(set(a['summary']) | set(b['summary'])):
        if a['summary'].get(k) != b['summary'].get(k):
            print(f'summary {k}: {a["summary"].get(k)} vs {b["summary"].get(k)}')
print('RESULT', 'EQUAL' if not bad else 'DIFFERENT')
sys.exit(1 if bad else 0)
