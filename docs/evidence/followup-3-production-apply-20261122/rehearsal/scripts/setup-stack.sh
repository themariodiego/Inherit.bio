#!/usr/bin/env bash
# LOCAL ONLY. Create the isolated rehearsal stack "relk4", as the follow-up kit's
# setup-stack.sh created "relfu": its own project id, its own ports (58320-58329; the
# database on 127.0.0.1:58322) and its own container (supabase_db_relk4), never the shared
# stack on 54322 (project "sequence"), which other work uses and which this rehearsal
# neither resets nor writes. Every service but the database is excluded.
#   setup-stack.sh              scratch projects, then start the stack:
#     $K4_SCRATCH/proj        main 12f24475's supabase/ (245 migrations), so `supabase db
#                             reset --workdir proj` rebuilds fresh main, as every earlier
#                             mirror build did;
#     $K4_SCRATCH/proj-head   the pinned tree's supabase/ (302 migrations; equivalence.sh);
#   setup-stack.sh --stop       stop it and delete its container, volume and network.
set -euo pipefail
. "$(dirname "$0")/env.sh"
if [ "${1:-}" = --stop ]; then
  "$CLI" stop --no-backup --workdir "$W/proj"
  exit 0
fi
TREE=$(sed -n "s/^REV_TREE = '\([0-9a-f]*\)'.*/\1/p" "$G/generate.py")
mkdir -p "$W/src" "$W/logs"
rm -rf "$W/src/main"; mkdir -p "$W/src/main"
git -C "$REPO" archive 12f24475094653afe8f9935b75f352d76012b1b4 supabase | tar -x -C "$W/src/main"
relk4() {  # relk4 <project dir>: the project id and ports of the isolated stack
  sed -i 's/^project_id = "sequence"/project_id = "relk4"/; s/^port = 54321/port = 58321/; s/^port = 54322/port = 58322/;
   s/^shadow_port = 54320/shadow_port = 58320/; s/^port = 54329/port = 58329/; s/^port = 54323/port = 58323/;
   s/^port = 54324/port = 58324/; s/^inspector_port = 8083/inspector_port = 58383/; s/^port = 54327/port = 58327/' \
    "$1/supabase/config.toml"
  grep -q '^project_id = "relk4"' "$1/supabase/config.toml" && grep -q '^port = 58322' "$1/supabase/config.toml"
}
rm -rf "$W/proj"; mkdir -p "$W/proj"; cp -r "$W/src/main/supabase" "$W/proj/supabase"; relk4 "$W/proj"
[ "$(ls "$W/proj/supabase/migrations" | wc -l)" = 245 ]
# The pinned tree's migrations, with the repository's supabase/ around them (tests, seed, config).
rm -rf "$W/proj-head"; mkdir -p "$W/proj-head"
git -C "$REPO" archive HEAD supabase | tar -x -C "$W/proj-head"
rm -rf "$W/proj-head/supabase/migrations"; mkdir -p "$W/proj-head/supabase/migrations"
git -C "$REPO" archive "$TREE" | tar -x -C "$W/proj-head/supabase/migrations"
relk4 "$W/proj-head"
[ "$(ls "$W/proj-head/supabase/migrations" | wc -l)" = 302 ]
( time "$CLI" start --workdir "$W/proj" \
  -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor ) \
  > "$W/logs/start-main.log" 2>&1
echo "relk4 started: $(grep -c 'Applying migration' "$W/logs/start-main.log") migrations applied; ledger $(ledger)"
