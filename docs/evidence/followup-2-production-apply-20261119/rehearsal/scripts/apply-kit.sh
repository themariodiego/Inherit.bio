#!/usr/bin/env bash
# LOCAL ONLY. Apply an earlier guarded kit's batches to the local mirror exactly as its
# RUNBOOK runs them with the psql transport: regenerate its batch files with its own
# generate.py and the --head its runbook pins, check its SHA256SUMS, then for every batch
# the dry run (rc 3, exactly one ERROR, the sentinel) read back EQUAL to its pre-state,
# the apply (rc 0) read back EQUAL to its post-state, and the ledger.
#   apply-kit.sh <kit dir> <head rev> <log tag>
# The caller exports PGPASSWORD for the local stack.
set -eu
. "$(dirname "$0")/env.sh"
K=$1; HEADREV=$2; TAG=$3
L=$W/logs/mirror; mkdir -p "$L"
GK=$K/guarded
( cd "$GK" && python3 -I generate.py --head "$HEADREV" final > "$L/$TAG-generate.log" 2>&1 )
( cd "$GK" && sha256sum -c SHA256SUMS ) > "$L/$TAG-sha256sums.txt" 2>&1
( cd "$K/api" && sha256sum -c SHA256SUMS ) >> "$L/$TAG-sha256sums.txt" 2>&1
echo "$TAG: generate.py --head ${HEADREV:0:8} final; SHA256SUMS $(grep -c ': OK$' "$L/$TAG-sha256sums.txt") lines OK, $(grep -vc ': OK$' "$L/$TAG-sha256sums.txt") not OK"
[ -z "$(git -C "$REPO" status --porcelain -- "$K")" ] || { echo "$TAG: regenerating changed a tracked file"; exit 1; }
N=$(python3 -I -c "import json,sys; print(len(json.load(open(sys.argv[1]))['batches']))" "$GK/expected-summaries.json")
for k in $(seq 1 "$N"); do
  timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 -c "set statement_timeout = '180s'" -f "$GK/batch-$k-dry-run.sql" > "$L/$TAG-dry-$k.log" 2>&1 && rc=0 || rc=$?
  [ "$rc" = 3 ] && [ "$(grep -c 'ERROR:' "$L/$TAG-dry-$k.log")" = 1 ] && grep -q 'ERROR:  DRY_RUN_COMPLETE_ALL_CHECKS_PASSED' "$L/$TAG-dry-$k.log"
  fpto "$L/fp-$TAG-$k-after-dry.json"
  python3 -I "$GK/check-readback.py" "$L/fp-$TAG-$k-after-dry.json" "$k" pre > /dev/null
  t0=$(date +%s.%N)
  timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 -c "set statement_timeout = '180s'" -f "$GK/batch-$k-apply.sql" > "$L/$TAG-apply-$k.log" 2>&1
  t1=$(date +%s.%N)
  fpto "$L/fp-$TAG-$k-post.json"
  rb=$(python3 -I "$GK/check-readback.py" "$L/fp-$TAG-$k-post.json" "$k" post)
  echo -e "$TAG b$k\tdry rc=$rc sentinel, read-back EQUAL $k pre\tapply rc=0 $(printf '%.3f' "$(echo "$t1-$t0" | bc)")s\t$rb\tledger $(ledger)"
done
cp "$L/fp-$TAG-$N-post.json" "$L/fp-$TAG-final.json"
echo "$TAG final fingerprint $(sha "$L/fp-$TAG-final.json")"
