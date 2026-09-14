#!/usr/bin/env python3
"""What the model says when the person's own population is absent.

The situation almost every real person is in: no reference set contains
everyone. Draws from one population, then estimates WITHOUT it in the set, and
reports what comes back instead.

    SEEDS=6 python3 scripts/ancestry-resolution/measure-leave-one-out.py
Reference data is fetched from public APIs at run time and written beside this
script; nothing here is committed to the reference store, and no marker enters
`data/ref/` without a licence-audit row (docs/dataset-licenses.md, D-022).
NOTHING HERE READS A REAL PERSON'S FILE: every simulated person is drawn from
published population allele frequencies.
"""
import json, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
raw = json.load(open(os.path.join(HERE, "gnomad-pops.json")))
def named(pid):
    return (pid.startswith("hgdp:") or pid.startswith("1kg:")) and not pid.endswith(("_XX","_XY","XX","XY"))
counts = {}
for v, pops in raw.items():
    for p in pops:
        if named(p["id"]): counts[p["id"]] = counts.get(p["id"], 0) + 1
ALL = sorted(p for p, n in counts.items() if n == len(raw))
alleles = {p: min(next(x["an"] for x in raw[v] if x["id"] == p) for v in raw) for p in ALL}
ALL = [p for p in ALL if alleles[p] >= 20]
LO, HI = 0.001, 0.999
FULL = []
for v, pops in raw.items():
    by = {p["id"]: p for p in pops}
    FULL.append([min(HI, max(LO, by[p]["ac"] / by[p]["an"])) for p in ALL])

def em(obs, K):
    q = [1.0/K]*K
    for _ in range(1200):
        nxt = [0.0]*K
        for d, fr in obs:
            pa = sum(q[k]*fr[k] for k in range(K)); pr = 1-pa
            for k in range(K):
                nxt[k] += d*(q[k]*fr[k]/pa) + (2-d)*(q[k]*(1-fr[k])/pr)
        t = sum(nxt); delta = 0.0
        for k in range(K):
            nxt[k] /= t; delta = max(delta, abs(nxt[k]-q[k]))
        q = nxt
        if delta < 1e-9: break
    return q

# LEAVE ONE OUT: draw a person from population X, then estimate WITHOUT X in
# the reference set. This is the situation a real person is in whenever their
# own population is not one of the 51 - which is almost everyone.
TARGETS = [p for p in ["1kg:ibs","hgdp:french","hgdp:mozabite","hgdp:bedouin","1kg:pel","hgdp:han"] if p in ALL]
SEEDS = int(os.environ.get("SEEDS","6"))
print(f"reference populations {len(ALL)}, markers {len(FULL)}")
print("drawn from a population the model does NOT contain; what it says instead\n")
for name in TARGETS:
    src = ALL.index(name)
    keep = [i for i in range(len(ALL)) if i != src]
    names = [ALL[i] for i in keep]
    F = [[row[i] for i in keep] for row in FULL]
    K = len(keep)
    tally = {}
    for s_ in range(SEEDS):
        rng = random.Random(31337 + src*53 + s_)
        obs = [(sum(1 for _ in range(2) if rng.random() < row[src]), fr) for row, fr in zip(FULL, F)]
        q = em(obs, K)
        order = sorted(range(K), key=lambda k: -q[k])[:2]
        label = " + ".join(f"{names[k].split(':')[1]} {q[k]:.2f}" for k in order)
        tally[label] = tally.get(label, 0) + 1
    top = sorted(tally.items(), key=lambda kv: -kv[1])
    print(f"{name:16} -> " + "; ".join(f"{lab} (x{n})" for lab, n in top[:3]), flush=True)
