"""LOCAL ONLY: map every md5 literal of release 4's 21 migrations to what it checks.

    python3 -I guards.py <steps-dir> <mirror log dir> <out guard-map.json>

Release 3's guards.py parsed each guard's syntax; release 4's files write their guards in
several forms (predecessor clauses, values lists with and without an ACL, patch tables
with before/after md5s, def/src pins, constraint pins, postflights). So this one maps each
32-hex literal by its value instead, against what steps.py measured on the mirror of
release 3's post-state: funcs-00-pre.json (the pre-state), funcs-NN.json and fp-NN.json
(after migration NN, applied one by one in filename order). For the literal at line L of
migration #i it reports the first of:
  pin        the md5 (pg_get_functiondef under the session's settings, or prosrc) of a
             function as it stands just before #i; `origin` says who last wrote that body:
             the pre-state (then also: production as read back on 2026-10-22, release 1,
             release 2 or release 3) or an earlier migration #k of this release;
  successor  the md5 of a function as #i leaves it (a patch's or postflight's successor);
  constraint the md5 of a constraint's definition just before #i (pin) or after it
             (successor), from the fingerprint;
  chained    none of these, but the literal also occurs in #i as another patch's
             predecessor or successor: an intermediate body inside #i's own patch chain;
  other      anything else (listed; each must be explained in the README).
The nearest signature quoted before the literal is recorded, and used to pick the
function when one md5 matches several. Every literal of the 21 files is accounted for.
"""
import json
import os
import re
import sys

D, ML, OUT = sys.argv[1:4]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kitgit  # noqa: E402
files = kitgit.release_files()
steps = {s['index']: s for s in json.load(open(f'{D}/steps.json'))}
N = len(files)
funcs = {0: json.load(open(f'{D}/funcs-00-pre.json'))}
fps = {0: json.load(open(f'{D}/fp-00-pre.json'))}
for i in range(1, N + 1):
    funcs[i] = json.load(open(f'{D}/funcs-{i:02d}.json'))
    fps[i] = json.load(open(f'{D}/fp-{i:02d}.json'))


def fpfun(name):
    """(schema.name, def_md5) pairs of a fingerprint: its argument text is printed under the
    pinned search_path, so a function is matched by name and body, not by that text."""
    fp = json.load(open(os.path.join(ML, name)))
    return {(f"{f['schema']}.{f['name']}", f['def_md5']) for f in fp['functions']}


EARLIER = [('production (2026-10-22 read-back)', fpfun('fp-mirror-pr323.json')),
           ('release 1 (PR 324)', fpfun('fp-pr324-final.json')),
           ('release 2 (the follow-up)', fpfun('fp-followup-final.json')),
           ('release 3 (follow-up 2)', fpfun('fp-followup2-final.json'))]


def first_writer(key, pin):
    """The earliest of production / release 1 / 2 / 3 whose fingerprint already holds this body."""
    return next((name for name, m in EARLIER if (key.split('(')[0], pin) in m), 'unknown')


def by_identity(state):
    """function key (schema.name(identity args)) -> the fingerprint key, which is the same text."""
    return state


def constraints(fp):
    out = {}
    for t in fp['tables']:
        for c in t['constraints']:
            out.setdefault(c[1], []).append(f"{t['schema']}.{t['name']}.{c[0]}")
    return out


def changed_at(key, i):
    """The last step k <= i at which the function's body (def_sess) changed or it appeared."""
    last = 0 if key in funcs[0] else None
    for k in range(1, i + 1):
        a, b = funcs[k - 1].get(key), funcs[k].get(key)
        if b is not None and (a is None or a['def_sess'] != b['def_sess'] or a['oid'] != b['oid']):
            last = k
    return last


SIG = re.compile(r"'((?:public|private|auth|storage|extensions)\.[a-z0-9_]+\([^')]*\))'")
rows, literals = [], {}
for i, (f, data) in enumerate(files, 1):
    text = data.decode('utf-8')
    # every 32-hex token, quoted alone or not (one file pins three constraints in one
    # 'name md5,name md5,...' string), in code or in a comment
    lits = list(re.finditer(r"(?<![0-9a-f])([0-9a-f]{32})(?![0-9a-f])", text))
    literals[f] = len({m.group(1) for m in lits})
    counts = {}
    for m in lits:
        counts[m.group(1)] = counts.get(m.group(1), 0) + 1
    pre, post = funcs[i - 1], funcs[i]
    cpre, cpost = constraints(fps[i - 1]), constraints(fps[i])
    for m in lits:
        h = m.group(1)
        line = text.count('\n', 0, m.start()) + 1
        sigs = SIG.findall(text, 0, m.start())
        near = sigs[-1] if sigs else None
        nearreg = near.replace('timestamptz', 'timestamp with time zone') if near else None

        def hits(state, field):
            return sorted(k for k, v in state.items() if v[field] == h)

        def choose(ks):
            if len(ks) <= 1:
                return ks[0] if ks else None
            exact = [k for k in ks if state_reg(k) == nearreg]
            return exact[0] if len(exact) == 1 else ks[0]

        def state_reg(k):
            v = pre.get(k) or post.get(k)
            return v['regproc'] if v else None
        ls = text.rfind('\n', 0, m.start()) + 1
        r = dict(index=i, file=f, line=line, md5=h, near_signature=near, occurrences_in_file=counts[h],
                 in_comment='--' in text[ls:m.start()])
        k_def, k_src = hits(pre, 'def_sess'), hits(pre, 'prosrc')
        s_def, s_src = hits(post, 'def_sess'), hits(post, 'prosrc')
        if k_def or k_src:
            key = choose(k_def or k_src)
            w = changed_at(key, i - 1)
            r.update(kind='pin', measure='def' if k_def else 'src', function=key, regproc=pre[key]['regproc'],
                     acl=pre[key]['acl'], also=len(k_def or k_src) - 1,
                     search_path_dependent=pre[key]['def_sess'] != pre[key]['def_pin'],
                     origin=('pre-state: ' + first_writer(key, pre[key]['def_pin'])) if w == 0 else f'#{w:02d}',
                     changed_by_this_migration=(post.get(key) is None or post[key]['def_sess'] != pre[key]['def_sess']))
        elif s_def or s_src:
            key = choose(s_def or s_src)
            r.update(kind='successor', measure='def' if s_def else 'src', function=key, regproc=post[key]['regproc'],
                     acl=post[key]['acl'], also=len(s_def or s_src) - 1)
        elif h in cpre or h in cpost:
            which = 'pin' if h in cpre else 'successor'
            r.update(kind='constraint', role=which, constraint=(cpre.get(h) or cpost.get(h))[0],
                     origin=None if which == 'successor' else
                     ('pre-state' if h in constraints(fps[0]) and all(h in constraints(fps[k]) for k in range(0, i)) else 'in-release'))
        elif counts[h] > 1:
            r.update(kind='chained')
        else:
            r.update(kind='other')
        rows.append(r)

json.dump(dict(literals=literals, guards=rows), open(OUT, 'w'), indent=1)
kinds = {}
for r in rows:
    kinds[r['kind']] = kinds.get(r['kind'], 0) + 1
print('literal uses', len(rows), 'distinct per file', sum(literals.values()), kinds)
pre_fns = {}
for r in rows:
    if r['kind'] == 'pin' and r['origin'].startswith('pre-state'):
        pre_fns.setdefault((r['function'], r['measure']), set()).add(r['md5'])
print('pins on bodies that exist before this release (function, measure):', len(pre_fns),
      'with more than one md5:', [k for k, v in pre_fns.items() if len(v) > 1])
for r in rows:
    if r['kind'] in ('other', 'chained'):
        print(f"#{r['index']:02d}:{r['line']} {r['kind']} {r['md5']} near {r['near_signature']}")
