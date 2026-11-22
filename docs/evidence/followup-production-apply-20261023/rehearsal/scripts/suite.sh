#!/usr/bin/env bash
# LOCAL ONLY: run one revision's pgTAP suite against the relfu stack (127.0.0.1:56322).
#   suite.sh <tests-dir> <log>
# <tests-dir> is a supabase/tests tree (from `git archive <rev> supabase`); it replaces the
# relfu project's supabase/tests, then `supabase test db` runs it. pgTAP is dropped again
# afterwards so the catalog returns to its rehearsed state (the caller compares the
# fingerprint and ledger before and after).
set -uo pipefail
W=${RELFU_SCRATCH:?scratch directory of the relfu project}
DB=${RELFU_DB:-postgresql://postgres@127.0.0.1:56322/postgres}
case "$DB" in *:54322/*) echo "refusing the shared stack"; exit 1;; esac
src=$1; out=$2
rm -rf "$W/proj/supabase/tests" && cp -r "$src" "$W/proj/supabase/tests"
cd "$W/proj" && ( time /home/user/Inherit.bio/node_modules/.bin/supabase test db --workdir "$W/proj" ) > "$out" 2>&1; echo "rc=$?" >> "$out"
psql "$DB" -X -q -c "drop extension if exists pgtap" > /dev/null 2>&1
