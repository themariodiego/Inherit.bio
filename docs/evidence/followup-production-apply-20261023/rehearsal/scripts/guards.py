"""LOCAL ONLY: map every md5 guard of the 7 follow-up migrations to the body it checks.

    python3 -I guards.py <steps-dir> <production fp-4-post.json> <out guard-map.json>

Reads steps.py's captures: funcs-prod.json (production state = the mirror before PR
324's batches), funcs-00-pr324.json (PR 324's rehearsed post-state), funcs-NN.json
(after follow-up migration NN). Every guard is parsed from the migration text:
  * md5(prosrc)='<hash>' with the block's `target regprocedure:='...'`;
  * the patch tables (ordinal,'target','before','after','acl',...) compared with
    md5(pg_get_functiondef(p.oid)) and p.proacl::text;
  * 20261023130000's derivation guard md5(pg_get_functiondef(p.oid))='<hash>'.
For each predecessor it reports where the body comes from (production, PR 324, or an
earlier step of this release), whether the state just before the migration holds it
with the required ACL, whether production's read-back holds it today, and whether
its md5 depends on the session's search_path. Every 32-hex literal of the 7 files
must be accounted for.
"""
import json
import os
import re
import subprocess
import sys

D, PROD_FP, OUT = sys.argv[1:4]
W = os.environ['RELFU_SCRATCH']
base = set(os.listdir(f'{W}/src/pr324/supabase/migrations'))
files = sorted(f for f in os.listdir(f'{W}/src/fu/supabase/migrations') if f not in base)
states = {'prod': json.load(open(f'{D}/funcs-prod.json')), 'pr324': json.load(open(f'{D}/funcs-00-pr324.json'))}
for i in range(1, 8):
    states[i] = json.load(open(f'{D}/funcs-{i:02d}.json'))
prod_fp = {f"{f['schema']}.{f['name']}({f['args']})": f for f in json.load(open(PROD_FP))['functions']}
STRIPPED = {'private.claim_next_own_preparation_v1', 'private.current_adult_subject_invitation_v1',
            'private.own_report_generation_v1', 'private.own_subject_purpose_grant_v1',
            'private.read_own_upload_finalization_checkpoint_v1', 'private.write_own_upload_finalization_checkpoint_v1',
            'public.claim_due_research_publication_v1', 'public.record_blocked_embryo_response_v1'}


def regproc_key(state, sig):
    """'private.f(uuid,jsonb)' -> the capture key, through the function's oid on the live stack."""
    oid = OIDS.get(sig)
    oid = int(oid) if oid is not None else None
    hits = [k for k, v in state.items() if v['oid'] == oid]
    return hits[0] if len(hits) == 1 else None


def origin_of(fn, kind, md5):
    """Which state first holds md5 for fn: production, PR 324 or a follow-up step."""
    field = 'prosrc' if kind == 'prosrc' else 'def_sess'
    if states['prod'].get(fn, {}).get(field) == md5:
        return 'production'
    if states['pr324'].get(fn, {}).get(field) == md5:
        return 'PR 324'
    for i in range(1, 8):
        if states[i].get(fn, {}).get(field) == md5:
            return f'follow-up #{i}'
    return None


guards, literals_seen = [], {}
for i, f in enumerate(files, 1):
    text = open(f'{W}/src/fu/supabase/migrations/{f}', encoding='utf-8').read()
    lits = {m.group(1): text.count('\n', 0, m.start()) + 1 for m in re.finditer(r"'([0-9a-f]{32})'", text)}
    accounted = set()
    pre_state = states['pr324'] if i == 1 else states[i - 1]
    # (1) md5(prosrc) guards with a target regprocedure
    for blk in re.finditer(r"declare target regprocedure:='([^']+)'::regprocedure;(.*?)\n\$\w+\$;", text, re.S):
        sig, body = blk.group(1), blk.group(2)
        hs = re.findall(r"md5\(prosrc\)='([0-9a-f]{32})'", body)
        assert len(hs) == 2, (f, hs)
        guards.append(dict(index=i, file=f, line=lits[hs[0]], target=sig, kind='prosrc', before=hs[0], after=hs[1], acl=None))
        accounted |= set(hs)
    # (2) patch tables compared with md5(pg_get_functiondef)
    for row in re.finditer(r"\((\d+),'([a-z0-9_.]+\([^']*\))','([0-9a-f]{32})',\s*'([0-9a-f]{32})',\s*'(\{[^']*\})',", text):
        n, sig, b, a, acl = row.groups()
        guards.append(dict(index=i, file=f, line=text.count('\n', 0, row.start()) + 1, ordinal=int(n), target=sig,
                           kind='def', before=b, after=a, acl=acl))
        accounted |= {b, a}
    # (3) the derivation guard of 20261023130000: a predecessor check, then the derived
    # function's successor check (the one followed by ") then").
    pat = r"where p\.oid='([^']+)'::regprocedure\s+and md5\(pg_get_functiondef\(p\.oid\)\)='([0-9a-f]{32})' and p\.proacl::text='(\{[^']*\})'"
    ms = list(re.finditer(pat, text))
    if ms:
        assert len(ms) == 2 and text[ms[1].end():ms[1].end() + 6] == ') then', (f, len(ms))
        (sig, b, acl), (dsig, a, dacl) = ms[0].groups(), ms[1].groups()
        guards.append(dict(index=i, file=f, line=text.count('\n', 0, ms[0].start()) + 1, target=sig, kind='def', before=b,
                           after=a, acl=acl, derived=dsig, derived_acl=dacl))
        accounted |= {b, a}
    missing = set(lits) - accounted
    assert not missing, (f, missing)
    literals_seen[f] = len(lits)

sigs = sorted({g['target'] for g in guards} | {g['derived'] for g in guards if g.get('derived')})
q = "select jsonb_object_agg(s, pg_catalog.to_regprocedure(s)::oid) from unnest(array[%s]) s" % ','.join("'" + x + "'" for x in sigs)
OIDS = json.loads(subprocess.run(['psql', os.environ.get('RELFU_DB', 'postgresql://postgres@127.0.0.1:56322/postgres'), '-X', '-At',
                                  '-c', q], check=True, capture_output=True, text=True,
                                 env=dict(os.environ, PGCLIENTENCODING='UTF8')).stdout)
rows = []
for g in guards:
    i = g['index']
    pre_state = states['pr324'] if i == 1 else states[i - 1]
    fn = regproc_key(pre_state, g['target'])
    field = 'prosrc' if g['kind'] == 'prosrc' else 'def_sess'
    # Predecessors of a second patch of the same function inside one migration are
    # the first patch's successor: the state before the migration does not hold them.
    same = [h for h in guards if h['index'] == i and h['target'] == g['target'] and h.get('ordinal', 0) < g.get('ordinal', 0)]
    chained = any(h['after'] == g['before'] for h in same)
    holds = fn is not None and pre_state[fn][field] == g['before']
    acl_ok = g['acl'] is None or (fn is not None and pre_state[fn]['acl'] == g['acl'])
    origin = 'in-migration (successor of the previous patch)' if chained else origin_of(fn, g['kind'], g['before'])
    succ_fn = regproc_key(states[i], g.get('derived') or g['target'])
    succ_ok = g['after'] is None or (succ_fn is not None and states[i][succ_fn][field] == g['after'])
    pf = prod_fp.get(fn) if fn else None
    prod_state = states['prod'].get(fn) if fn else None
    prod_now = None
    if fn and pf:
        # production's fingerprint def_md5 is under the pinned search_path; equality with the
        # mirror's production-state def_pin means production's body is the mirror's.
        same_body = prod_state is not None and pf['def_md5'] == prod_state['def_pin']
        prod_now = bool(same_body and prod_state[field] == g['before'])
    rows.append(dict(**g, function=fn, field=field, pre_state_holds=holds or chained, acl_ok=acl_ok, origin=origin,
                     successor_ok=succ_ok, in_production_today=prod_now if not chained else False,
                     in_production_fingerprint=pf is not None,
                     production_def_md5=pf['def_md5'] if pf else None,
                     search_path_dependent=(fn is not None and pre_state[fn]['def_sess'] != pre_state[fn]['def_pin']),
                     stripped_body=(fn or '').split('(')[0] in STRIPPED))
json.dump(dict(literals=literals_seen, guards=rows), open(OUT, 'w'), indent=1)
for r in rows:
    print(f"#{r['index']} :{r['line']:<4} {r['kind']:6} {r['target'][:70]:70} pred {r['before'][:8]} {r['origin']!s:12} "
          f"holds={r['pre_state_holds']} acl={r['acl_ok']} succ={r['successor_ok']} prod_today={r['in_production_today']} "
          f"sp_dep={r['search_path_dependent']} stripped={r['stripped_body']}")
print('literals per file', literals_seen, 'guards', len(rows))
