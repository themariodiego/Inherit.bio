"""LOCAL ONLY: map every md5 guard of this release's 4 migrations to the body it checks.

    python3 -I guards.py <steps-dir> <mirror log dir> <out guard-map.json>

Reads steps.py's captures (funcs-00-pre.json: the follow-up kit's post-state on the
mirror; funcs-NN.json: after migration NN) and the mirror build's fingerprints
(<mirror log dir>/fp-mirror-pr323.json, equal to production's 2026-10-22 read-back
object for object; fp-pr324-final.json; fp-followup-final.json). Every guard is parsed
from the migration text, read from the pinned tree (kitgit.py):
  * predecessor clauses `p.oid='<sig>'::regprocedure and md5(pg_get_functiondef(p.oid))='<h>'
    [and p.proacl::text='<acl>']` (20261024110000, 20261025200000, 20261025400000);
  * the values list `('<sig>','<h>')` of 20261025400000's six callees (no ACL); a callee
    listed twice (current_adult_subject_invitation_v1: two reviewed bodies) holds when the
    pre-state holds either md5 (field `holds_either` on each of its rows);
  * the patch tables (ordinal,'target','before','after','acl',...) (20261024110000,
    20261025400000);
  * 20261025200000's postflight `where oid='<sig>'::regprocedure) is distinct from '<h>'`.
For each predecessor it reports where the body comes from (production as read back on
2026-10-22, PR 324's release, the follow-up's release, or an earlier patch of the same
file), whether the pre-state holds it with the required ACL, and whether its md5 depends
on search_path. Every 32-hex literal of the 4 files must be accounted for.
"""
import json
import os
import re
import subprocess
import sys

D, ML, OUT = sys.argv[1:4]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kitgit  # noqa: E402
files = kitgit.release_files()
steps = {s['index']: s for s in json.load(open(f'{D}/steps.json'))}
states = {0: json.load(open(f'{D}/funcs-00-pre.json'))}
for i in range(1, 5):
    p = f'{D}/funcs-{i:02d}.json'
    if os.path.exists(p) and steps.get(i, {}).get('rc') == 0:
        states[i] = json.load(open(p))


def fpfun(name):
    fp = json.load(open(os.path.join(ML, name)))
    return {f"{f['schema']}.{f['name']}({f['args']})": f['def_md5'] for f in fp['functions']}


prod, pr324, fu = fpfun('fp-mirror-pr323.json'), fpfun('fp-pr324-final.json'), fpfun('fp-followup-final.json')
OIDQ = "select jsonb_object_agg(s, pg_catalog.to_regprocedure(s)::oid) from unnest(%s::text[]) s"


def keyof(state, sig):
    oid = OIDS.get(sig)
    hits = [k for k, v in state.items() if oid is not None and v['oid'] == int(oid)]
    return hits[0] if len(hits) == 1 else None


def origin(fn, pre):
    """Where the pre-state's body of fn was last written, by its pinned def_md5."""
    if fn is None:
        return 'absent before this release'
    pin = pre[fn]['def_pin']
    if prod.get(fn) == pin:
        return 'production (2026-10-22 read-back)'
    if pr324.get(fn) == pin:
        return "PR 324's release"
    if fu.get(fn) == pin:
        return "the follow-up's release"
    return 'unknown'


guards, literals = [], {}
for i, (f, data) in enumerate(files, 1):
    text = data.decode('utf-8')
    lits = {m.group(1) for m in re.finditer(r"'([0-9a-f]{32})'", text)}
    acc = set()
    line = lambda pos: text.count('\n', 0, pos) + 1
    for m in re.finditer(r"p\.oid='([^']+)'::regprocedure\s+and md5\(pg_get_functiondef\(p\.oid\)\)='([0-9a-f]{32})'(?:\s+and p\.proacl::text='(\{[^']*\})')?", text):
        guards.append(dict(index=i, file=f, line=line(m.start()), kind='predecessor', target=m.group(1), before=m.group(2), acl=m.group(3)))
        acc.add(m.group(2))
    for m in re.finditer(r"\('([a-z0-9_.]+\([^']*\))','([0-9a-f]{32})'\)", text):
        guards.append(dict(index=i, file=f, line=line(m.start()), kind='callee', target=m.group(1), before=m.group(2), acl=None))
        acc.add(m.group(2))
    for m in re.finditer(r"\((\d+),'([a-z0-9_.]+\([^']*\))','([0-9a-f]{32})',\s*'([0-9a-f]{32})','(\{[^']*\})',", text):
        guards.append(dict(index=i, file=f, line=line(m.start()), kind='patch', ordinal=int(m.group(1)), target=m.group(2),
                           before=m.group(3), after=m.group(4), acl=m.group(5)))
        acc |= {m.group(3), m.group(4)}
    for m in re.finditer(r"where oid='([^']+)'::regprocedure\)\s+is distinct from '([0-9a-f]{32})'", text):
        guards.append(dict(index=i, file=f, line=line(m.start()), kind='postflight', target=m.group(1), before=m.group(2), acl=None))
        acc.add(m.group(2))
    missing = lits - acc
    assert not missing, (f, missing)
    literals[f] = len(lits)

sigs = sorted({g['target'] for g in guards})
q = OIDQ % ('array[' + ','.join("'" + s + "'" for s in sigs) + ']')
OIDS = json.loads(subprocess.run(['psql', 'postgresql://postgres@127.0.0.1:54322/postgres', '-X', '-At', '-c', q], check=True,
                                 capture_output=True, text=True, env=dict(os.environ, PGCLIENTENCODING='UTF8')).stdout)
rows = []
for g in guards:
    i = g['index']
    pre = states[i - 1] if (i - 1) in states else None
    post = states.get(i)
    fn = keyof(pre, g['target']) if pre else None
    chained = g['kind'] == 'patch' and any(h['index'] == i and h['target'] == g['target'] and h['kind'] == 'patch'
                                           and h['ordinal'] < g['ordinal'] and h['after'] == g['before'] for h in guards)
    have = pre[fn]['def_sess'] if (pre and fn) else None
    holds = (have == g['before']) if g['kind'] != 'postflight' else None
    acl_ok = None if g['acl'] is None else (pre is not None and fn is not None and pre[fn]['acl'] == g['acl'])
    succ = None
    if g['kind'] == 'patch' and post is not None:
        pk = keyof(post, g['target'])
        succ = pk is not None and any(post[pk]['def_sess'] == h['after'] for h in guards
                                      if h['index'] == i and h['target'] == g['target'] and h['kind'] == 'patch')
    if g['kind'] == 'postflight' and post is not None:
        pk = keyof(post, g['target'])
        succ = pk is not None and post[pk]['def_sess'] == g['before']
    rows.append(dict(**g, function=fn, pre_state_md5=have,
                     pre_state_holds=(True if chained else holds), acl_ok=acl_ok, successor_ok=succ,
                     origin=('in-migration (successor of the previous patch)' if chained else origin(fn, pre) if pre else None),
                     search_path_dependent=(fn is not None and pre[fn]['def_sess'] != pre[fn]['def_pin']),
                     applied=steps.get(i, {}).get('rc') == 0))
for r in rows:
    if r['kind'] == 'callee':
        same = [x for x in rows if x['kind'] == 'callee' and x['index'] == r['index'] and x['target'] == r['target']]
        r['alternatives'] = len(same)
        r['holds_either'] = any(x['pre_state_holds'] for x in same)
json.dump(dict(literals=literals, guards=rows), open(OUT, 'w'), indent=1)
for r in rows:
    print(f"#{r['index']} :{r['line']:<4} {r['kind']:11} {r['target'][:72]:72} want {r['before'][:8]} have {(r['pre_state_md5'] or '-')[:8]} "
          f"holds={r['pre_state_holds']}{' either=' + str(r['holds_either']) if r.get('alternatives', 1) > 1 else ''} acl={r['acl_ok']} succ={r['successor_ok']} from={r['origin']} sp_dep={r['search_path_dependent']}")
print('literals per file', literals, 'guards', len(rows))
