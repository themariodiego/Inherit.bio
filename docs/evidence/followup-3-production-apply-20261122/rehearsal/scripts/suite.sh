#!/usr/bin/env bash
# LOCAL ONLY: run one revision's whole pgTAP suite against the isolated stack relk4.
#   suite.sh <rev> <log>
# `git archive <rev> supabase` goes to a scratch project directory whose config.toml gets
# relk4's project id and ports (setup-stack.sh), so `supabase test db --local --workdir`
# runs that revision's supabase/tests against 127.0.0.1:58322, never the shared stack.
# pgTAP is dropped again afterwards so the catalog returns to its rehearsed state (the
# caller compares the fingerprint and ledger before and after).
set -u
. "$(dirname "$0")/env.sh"
rev=$1; out=$2
P=$W/proj-$(git -C "$REPO" rev-parse --short=8 "$rev")
rm -rf "$P" && mkdir -p "$P"
git -C "$REPO" archive "$rev" supabase | tar -x -C "$P"
sed -i 's/^project_id = "sequence"/project_id = "relk4"/; s/^port = 54321/port = 58321/; s/^port = 54322/port = 58322/;
 s/^shadow_port = 54320/shadow_port = 58320/; s/^port = 54329/port = 58329/; s/^port = 54323/port = 58323/;
 s/^port = 54324/port = 58324/; s/^inspector_port = 8083/inspector_port = 58383/; s/^port = 54327/port = 58327/' "$P/supabase/config.toml"
grep -q '^port = 58322' "$P/supabase/config.toml" || { echo "config not relk4"; exit 1; }
( cd "$P" && time "$CLI" test db --local --workdir "$P" ) > "$out" 2>&1; echo "rc=$?" >> "$out"
psql "$DB" -X -q -c "drop extension if exists pgtap" > /dev/null 2>&1
grep -E '^(Files=|Result:|rc=)' "$out" | tr '\n' ' '; echo
