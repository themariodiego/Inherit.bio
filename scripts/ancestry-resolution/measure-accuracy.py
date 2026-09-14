#!/usr/bin/env python3
"""How often the model names the population a person was drawn from.

Draws a simulated person from one population's frequencies and estimates over
all of them. THIS IS THE FRIENDLIEST TEST THE METHOD CAN BE GIVEN - the person
is a draw from the reference frequencies themselves - so the rates it returns
are an upper bound on what a real person gets.

    SEEDS=8 python3 scripts/ancestry-resolution/measure-accuracy.py
Reference data is fetched from public APIs at run time and written beside this
script; nothing here is committed to the reference store, and no marker enters
`data/ref/` without a licence-audit row (docs/dataset-licenses.md, D-022).
NOTHING HERE READS A REAL PERSON'S FILE: every simulated person is drawn from
published population allele frequencies.
"""
import json, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
raw = json.load(open(os.path.join(HERE, "gnomad-pops.json")))

# Keep only the named HGDP / 1KG populations; drop gnomAD's broad groups and sex splits.
def named(pid):
    return (pid.startswith("hgdp:") or pid.startswith("1kg:")) and not pid.endswith(("_XX","_XY","XX","XY"))

counts = {}
for vid, pops in raw.items():
    for p in pops:
        if named(p["id"]):
            counts.setdefault(p["id"], 0)
            counts[p["id"]] += 1
POPS = sorted(p for p, n in counts.items() if n == len(raw))
print(f"variants {len(raw)}, populations present at every variant: {len(POPS)}", file=sys.stderr)

MIN_AN = 20   # a population with fewer sampled alleles than this is too thin to model
alleles = {p: min(next(x["an"] for x in raw[v] if x["id"] == p) for v in raw) for p in POPS}
POPS = [p for p in POPS if alleles[p] >= MIN_AN]
print(f"after dropping populations under {MIN_AN} sampled alleles: {len(POPS)}", file=sys.stderr)

LO, HI = 0.001, 0.999
F = []
for vid, pops in raw.items():
    by = {p["id"]: p for p in pops}
    row = []
    ok = True
    for p in POPS:
        e = by.get(p)
        if not e or not e["an"]:
            ok = False; break
        row.append(min(HI, max(LO, e["ac"] / e["an"])))
    if ok: F.append(row)
K = len(POPS)
print(f"usable markers {len(F)}, populations {K}\n", file=sys.stderr)

def em(obs):
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

TARGETS = [p for p in ["1kg:ibs","hgdp:french","hgdp:mozabite","hgdp:bedouin"] if p in POPS]
SEEDS = int(os.environ.get("SEEDS","10"))
REPS = [1, 4]
print(f"{'truth':16}" + "".join(f"{len(F)*r:>10}" for r in REPS) + "   (names it exactly / in its own region)")
REGION = lambda p: p.split(":")[0]
for name in TARGETS:
    idx = POPS.index(name); cells = []
    for r in REPS:
        hit = 0
        for s_ in range(SEEDS):
            rng = random.Random(777 + idx*97 + s_*11 + r)
            obs = []
            for _ in range(r):
                for fr in F:
                    obs.append((sum(1 for _ in range(2) if rng.random() < fr[idx]), fr))
            q = em(obs)
            if max(range(K), key=lambda k: q[k]) == idx: hit += 1
        cells.append(f"{100*hit/SEEDS:>9.0f}%")
    print(f"{name:16}" + "".join(cells), flush=True)
