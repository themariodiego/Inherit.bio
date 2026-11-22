#!/usr/bin/env bash
# LOCAL ONLY: run one revision's whole pgTAP suite against the local stack.
#   suite.sh <rev> <log>
# `git archive <rev> supabase` goes to a scratch project directory whose config.toml
# (project "sequence") is the repository's own, so `supabase test db --local --workdir`
# runs that revision's supabase/tests against the local stack without touching the
# working tree. pgTAP is dropped again afterwards so the catalog returns to its
# rehearsed state (the caller compares the fingerprint and ledger before and after).
set -u
. "$(dirname "$0")/env.sh"
rev=$1; out=$2
P=$W/proj-$(git -C "$REPO" rev-parse --short=8 "$rev")
rm -rf "$P" && mkdir -p "$P"
git -C "$REPO" archive "$rev" supabase | tar -x -C "$P"
cmp "$P/supabase/config.toml" "$REPO/supabase/config.toml"
( cd "$P" && time "$CLI" test db --local --workdir "$P" ) > "$out" 2>&1; echo "rc=$?" >> "$out"
psql "$DB" -X -q -c "drop extension if exists pgtap" > /dev/null 2>&1
grep -E '^(Files=|Result:|rc=)' "$out" | tr '\n' ' '; echo
