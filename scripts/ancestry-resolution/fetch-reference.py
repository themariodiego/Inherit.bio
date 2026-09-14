#!/usr/bin/env python3
"""Fetch per-population allele frequencies for the shipped panel.

Queries gnomAD's public GraphQL API for every marker in `data/ref/aims.json`
and writes `gnomad-pops.json` beside this script. gnomAD returns the HGDP and
1000 Genomes populations by name (`hgdp:basque`, `1kg:ibs`, ...) with `ac` and
`an`, so each population carries its own sampled size and not only a frequency.

    python3 scripts/ancestry-resolution/fetch-reference.py
Reference data is fetched from public APIs at run time and written beside this
script; nothing here is committed to the reference store, and no marker enters
`data/ref/` without a licence-audit row (docs/dataset-licenses.md, D-022).
NOTHING HERE READS A REAL PERSON'S FILE: every simulated person is drawn from
published population allele frequencies.
"""
import json, subprocess, sys, time, os
HERE = os.path.dirname(os.path.abspath(__file__))
aims = json.load(open(os.path.join(HERE, "..", "..", "data", "ref", "aims.json")))
out = {}
BATCH = 8
def query(chunk):
    parts = []
    for i, m in enumerate(chunk):
        vid = f"{m['chrom']}-{m['pos38']}-{m['ref']}-{m['alt']}"
        parts.append(f'v{i}: variant(variantId: "{vid}", dataset: gnomad_r3) {{ variant_id genome {{ populations {{ id ac an }} }} }}')
    return "{ " + " ".join(parts) + " }"
for i in range(0, len(aims), BATCH):
    chunk = aims[i:i+BATCH]
    body = json.dumps({"query": query(chunk)})
    for attempt in range(4):
        p = subprocess.run(["curl","-sS","--max-time","90","-X","POST",
            "https://gnomad.broadinstitute.org/api",
            "-H","Content-Type: application/json","-d",body],
            capture_output=True, text=True)
        try:
            data = json.loads(p.stdout).get("data") or {}
            got = 0
            for k, v in data.items():
                if v and v.get("genome"):
                    out[v["variant_id"]] = v["genome"]["populations"]; got += 1
            if got or data: break
        except Exception:
            pass
        time.sleep(3 + attempt * 4)
    print(f"{i+len(chunk)}/{len(aims)} have={len(out)}", file=sys.stderr, flush=True)
    time.sleep(1)
json.dump(out, open(os.path.join(HERE, "gnomad-pops.json"), "w"))
print(f"wrote {len(out)}", file=sys.stderr)
