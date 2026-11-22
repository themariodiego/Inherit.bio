#!/usr/bin/env bash
# LOCAL ONLY order equivalence on the isolated stack relk4 (127.0.0.1:58322). Precondition:
# the caller saved the rehearsed final mirror's fingerprint and dump as
# $EQ/fp-mirror-final.json and $EQ/dump-mirror-final.sql (dump.sh), before this runs.
# Steps, each a `supabase db reset --local --workdir $W/proj-head [--version]` of the
# scratch project whose supabase/migrations holds exactly the pinned tree's 302 files
# (setup-stack.sh; checked here blob for blob):
#   1. fresh through 20261025400000 (281 files: release 3's migration tree), and that plain
#      chain against release 3's recorded post-state (it differs: production's drift is
#      part of that post-state);
#   2. the same, then this release's 21 files, each `psql -1 -f` as the CLI runs them;
#   3. fresh through all 302 files;
#   4. step 3 plus production's drift (drift.sh: the 8 comment-stripped bodies, pg_cron).
# Then: 2 == 3 (undrifted) and mirror-final == 4 (drifted), by fingerprint bytes and
# normalised dump. The caller exports PGPASSWORD for the local stack.
set -eu
. "$(dirname "$0")/env.sh"
SCRIPTS=$(cd "$(dirname "$0")" && pwd)
EQ=${EQ_LOG:-$W/logs/equivalence}; mkdir -p "$EQ"
P=$W/proj-head
fp() { fpto "$EQ/fp-$1.json"; echo "fp-$1.json $(sha "$EQ/fp-$1.json") $(wc -c < "$EQ/fp-$1.json") bytes"; }
dump() { echo "dump-$1 $(bash "$SCRIPTS/dump.sh" "$EQ/dump-$1.sql")"; }
TREE=$(sed -n "s/^REV_TREE = '\([0-9a-f]*\)'.*/\1/p" "$G/generate.py")
want=$(git -C "$REPO" ls-tree "$TREE" | awk '{print $3}')
have=$(cd "$P" && for f in supabase/migrations/*.sql; do git hash-object "$f"; done)
[ "$want" = "$have" ]
reset_to() {  # reset_to <version> <expected count>
  ( time "$CLI" db reset --local --workdir "$P" --version "$1" ) > "$EQ/reset-$1.log" 2>&1
  [ "$(grep -c 'Applying migration' "$EQ/reset-$1.log")" = "$2" ]
  [ "$(ledger)" = "$2 $1" ]
}
{
echo "the relk4 head project's 302 migration files are the pinned tree's, blob for blob"
[ -s "$EQ/fp-mirror-final.json" ] && [ -s "$EQ/dump-mirror-final.norm.sql" ]
echo "fp-mirror-final.json $(sha "$EQ/fp-mirror-final.json") $(wc -c < "$EQ/fp-mirror-final.json") bytes; dump-mirror-final $(wc -l < "$EQ/dump-mirror-final.norm.sql") lines $(sha256sum < "$EQ/dump-mirror-final.norm.sql" | cut -c1-16)"
reset_to 20261025400000 281
fp fresh-281
echo "(0) plain fresh 20261025400000 vs release 3's recorded post-state (its batch-2 post summary):"
python3 -I "$KFU2/guarded/check-readback.py" "$EQ/fp-fresh-281.json" 2 post || true
python3 -I "$K324/rehearsal/scripts/fpcompare.py" "$EQ/fp-fresh-281.json" "$W/logs/mirror/fp-pre-state.json" | grep -v ': equal' | cut -c1-220 || true
t0=$(date +%s.%N)
for f in $(git -C "$REPO" diff --name-only --no-renames --diff-filter=A be49d283ec9a435c635ca54f28986d4676886910 "$TREE"); do
  git -C "$REPO" show "$TREE:$f" > "$EQ/$f"
  psql "$DB" -X -q -v ON_ERROR_STOP=1 -1 -f "$EQ/$f" > /dev/null
done
echo "be49d283 tree + the 21 (psql -1 -f each): $(printf '%.3f' "$(echo "$(date +%s.%N)-$t0" | bc)") s"
fp r3-plus-21; dump r3-plus-21
reset_to 20261122200000 302
fp fresh-302; dump fresh-302
bash "$SCRIPTS/drift.sh" "$EQ/drift" > /dev/null
fp fresh-302-drift; dump fresh-302-drift
cmp "$EQ/fp-r3-plus-21.json" "$EQ/fp-fresh-302.json" && echo "(a) undrifted: fingerprint byte-identical"
cmp "$EQ/dump-r3-plus-21.norm.sql" "$EQ/dump-fresh-302.norm.sql" && echo "(a) undrifted: normalised dump identical"
cmp "$EQ/fp-mirror-final.json" "$EQ/fp-fresh-302-drift.json" && echo "(b) drifted: fingerprint byte-identical"
cmp "$EQ/dump-mirror-final.norm.sql" "$EQ/dump-fresh-302-drift.norm.sql" && echo "(b) drifted: normalised dump identical"
} 2>&1 | tee "$EQ/equivalence.txt"
