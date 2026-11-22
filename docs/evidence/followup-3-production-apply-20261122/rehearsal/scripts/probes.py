"""LOCAL ONLY: summarize the four batch lock probes (local/batch-k-probe.sql, run by
rehearse.sh) into the relation locks each batch holds at its end, outside pg_catalog and
information_schema, with the tables that existed before the release marked.

    python3 -I probes.py <rehearsal log dir> <guard-map-independent out.txt>
"""
import json
import os
import re
import sys

L, OUT = sys.argv[1:3]
lines = ["# LOCAL ONLY: the relation locks each batch holds at its end (guarded/local/batch-k-probe.sql: the batch, "
         "then a raise listing pg_locks of the backend, so nothing persists), on the relk4 mirror, 2026-11-22. "
         "Catalog and information_schema relations and indexes left out; 'new' marks a relation the batch creates."]
for k in range(1, 5):
    t = open(os.path.join(L, f'probe-b{k}.log'), encoding='utf-8').read()
    m = re.search(r'PROBE_LOCKS (\[.*\])', t)
    locks = json.loads(m.group(1))
    keep = [l for l in locks if l[0] not in ('pg_catalog', 'information_schema', 'pg_toast') and l[2] in ('r', 'p', 'v')]
    strong = [f'{s}.{r}:{mode.replace("Lock", "")}' for s, r, kind, mode in keep if mode != 'AccessShareLock']
    share = sorted({f'{s}.{r}' for s, r, kind, mode in keep if mode == 'AccessShareLock'})
    lines.append(f'batch {k}: beyond ACCESS SHARE: {", ".join(strong) or "-"}')
    lines.append(f'batch {k}: ACCESS SHARE only on {len(share)} relations: {", ".join(share)}')
open(OUT, 'w').write('\n'.join(lines) + '\n')
print('\n'.join(l[:300] for l in lines))
