#!/usr/bin/env bash
# LOCAL ONLY: apply PR 324 migrations #FROM..#TO (filename order, 1-based) to the rel324 stack,
# each in its own transaction like the CLI. Usage: apply-range.sh FROM TO
set -euo pipefail
S=/tmp/claude-0/-home-user-Inherit-bio/6541a88f-5423-5787-89b6-a4effe2d1864/scratchpad/rel324
DB=postgresql://postgres:postgres@127.0.0.1:55322/postgres
export PGCLIENTENCODING=UTF8
i=0
for f in $(cd "$S/src/head-supabase/migrations" && ls | sort); do
  [ -e "$S/src/main-supabase/migrations/$f" ] && continue
  i=$((i+1)); [ "$i" -lt "$1" ] || [ "$i" -gt "$2" ] && continue
  psql "$DB" -X -q -v ON_ERROR_STOP=1 -1 -f "$S/src/head-supabase/migrations/$f" > /dev/null
  echo "applied #$i $f"
done
