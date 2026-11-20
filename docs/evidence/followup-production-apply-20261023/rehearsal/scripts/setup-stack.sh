#!/usr/bin/env bash
# LOCAL ONLY. Create the isolated rehearsal stack "relfu": its own project id, its own
# ports (56320-56329; the database on 127.0.0.1:56322) and its own container
# (supabase_db_relfu), never the shared stack on 54322. Every service but the database
# is excluded. The project is a scratch copy of main 12f24475's supabase/ (245
# migrations), so `supabase db reset` rebuilds fresh main, as PR 324's rehearsal did.
#   setup-stack.sh            create the scratch tree and start the stack
#   setup-stack.sh --stop     stop it and delete its container, volume and network
set -euo pipefail
W=${RELFU_SCRATCH:?scratch directory of the relfu project}
REPO=${REPO:-/home/user/wt-release3}
CLI=/home/user/Inherit.bio/node_modules/.bin/supabase
if [ "${1:-}" = --stop ]; then
  "$CLI" stop --no-backup --workdir "$W/proj"
  exit 0
fi
mkdir -p "$W/src" "$W/logs"
# main, PR 324's migration tree, PR 324's head (its pgTAP suite) and the follow-up head.
for r in 12f24475:main 538dcee6:pr324 cf79b1b6:pr324head 77d04563:fu; do
  rev=${r%%:*}; name=${r##*:}; rm -rf "$W/src/$name"; mkdir -p "$W/src/$name"
  git -C "$REPO" archive "$rev" supabase | tar -x -C "$W/src/$name"
done
rm -rf "$W/proj"; mkdir -p "$W/proj"; cp -r "$W/src/main/supabase" "$W/proj/supabase"
sed -i 's/^project_id = "sequence"/project_id = "relfu"/; s/^port = 54321/port = 56321/; s/^port = 54322/port = 56322/;
 s/^shadow_port = 54320/shadow_port = 56320/; s/^port = 54329/port = 56329/; s/^port = 54323/port = 56323/;
 s/^port = 54324/port = 56324/; s/^inspector_port = 8083/inspector_port = 58183/; s/^port = 54327/port = 56327/' \
  "$W/proj/supabase/config.toml"
grep -q '^project_id = "relfu"' "$W/proj/supabase/config.toml" && grep -q '^port = 56322' "$W/proj/supabase/config.toml"
cd "$W/proj" && ( time "$CLI" start --workdir "$W/proj" \
  -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor ) \
  > "$W/logs/start-main.log" 2>&1
grep -c 'Applying migration' "$W/logs/start-main.log"
