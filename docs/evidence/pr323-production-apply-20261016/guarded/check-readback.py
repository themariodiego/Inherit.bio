#!/usr/bin/env python3
# Run with: python3 -I check-readback.py <fingerprint-output.json> <batch 1-4> <pre|post>
# Compares the "summary" of a fingerprint.sql read-back with the expected pre- or
# post-state summary of that batch (expected-summaries.json, next to this file).
# Prints EQUAL and exits 0, or prints each differing category and exits 1.
import json
import os
import sys

fp_path, batch, which = sys.argv[1], int(sys.argv[2]), sys.argv[3]
here = os.path.dirname(os.path.abspath(__file__))
exp = {b['batch']: b for b in json.load(open(os.path.join(here, 'expected-summaries.json')))['batches']}
want = exp[batch]['pre_summary' if which == 'pre' else 'post_summary']
have = json.load(open(fp_path))['summary']
diff = [k for k in sorted(set(want) | set(have)) if want.get(k) != have.get(k)]
if diff:
    for k in diff:
        print(f'DIFFERENT {k}: have {have.get(k)} want {want.get(k)}')
    sys.exit(1)
print(f'EQUAL batch {batch} {which}-state summary')
