#!/usr/bin/env bash
# LOCAL ONLY, FIRST REHEARSAL ONLY (../data/first-rehearsal/). #4 as first written
# (d8dcb61a) refused on the mirror, so what it changes, the locks it takes and its timing
# were measured on a fresh, undrifted build of the repository's migrations through
# 20261025200000 (280 files; supabase db reset --local --version), where its guard held.
# The revised file applies on the mirror itself (steps.py, locktrace.py), so the second
# rehearsal did not use this script.
#   fresh-m04.sh <out dir>       The caller exports PGPASSWORD for the local stack.
set -eu
. "$(dirname "$0")/env.sh"
SCRIPTS=$(cd "$(dirname "$0")" && pwd)
O=$1; mkdir -p "$O"
( cd "$REPO" && "$CLI" db reset --local --version 20261025200000 ) > "$O/reset.log" 2>&1
[ "$(ledger)" = "280 20261025200000" ]
python3 -I "$SCRIPTS/locktrace.py" "$O/locktrace-m04.json" 4 4 | tee "$O/locktrace-m04.txt"
fpto "$O/fp-00-pre.json"
git -C "$REPO" show d8dcb61a0beb4f4616046b38a03ab5ed4d9c666c:supabase/migrations/20261025400000_path_a_account_accept_typed_name.sql > "$O/m04.sql"
t0=$(date +%s.%N)
psql "$DB" -X -v ON_ERROR_STOP=1 -1 -f "$O/m04.sql" > "$O/apply-04.log" 2>&1
echo "#04 applied on the fresh build: rc 0, $(printf '%.3f' "$(echo "$(date +%s.%N)-$t0" | bc)") s (psql -1 -f)"
fpto "$O/fp-04.json"
echo '[{"index": 4, "file": "20261025400000_path_a_account_accept_typed_name.sql", "rc": 0, "seconds": 0, "error": []}]' > "$O/steps.json"
python3 -I "$SCRIPTS/stepdiff.py" "$O"
