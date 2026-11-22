#!/usr/bin/env bash
# LOCAL ONLY order equivalence on the local stack (127.0.0.1:54322). Precondition: the
# caller saved the rehearsed final mirror's fingerprint and dump as $EQ/fp-mirror-final.json
# and $EQ/dump-mirror-final.sql (dump.sh), before this runs. Steps, each a
# `supabase db reset --local [--version]` of the repository's own migrations, whose working
# tree must hold exactly the pinned tree's files:
#   1. fresh through 20261023140000 (277 files: the follow-up's migration tree) — and that
#      plain chain against the follow-up kit's recorded post-state (it differs: production's
#      drift is part of that post-state);
#   2. the same, then this release's 4 files, each `psql -1 -f` as the CLI runs them;
#   3. fresh through all 281 files;
#   4. step 3 plus production's drift (drift.sh: the 8 comment-stripped bodies, pg_cron).
# Then: 2 == 3 (undrifted) and mirror-final == 4 (drifted), by fingerprint bytes and
# normalised dump. The caller exports PGPASSWORD for the local stack.
set -eu
. "$(dirname "$0")/env.sh"
SCRIPTS=$(cd "$(dirname "$0")" && pwd)
EQ=${EQ_LOG:-$W/logs/equivalence}; mkdir -p "$EQ"
fp() { fpto "$EQ/fp-$1.json"; echo "fp-$1.json $(sha "$EQ/fp-$1.json") $(wc -c < "$EQ/fp-$1.json") bytes"; }
dump() { echo "dump-$1 $(bash "$SCRIPTS/dump.sh" "$EQ/dump-$1.sql")"; }
TREE=$(sed -n "s/^REV_TREE = '\([0-9a-f]*\)'.*/\1/p" "$G/generate.py")
for f in $(git -C "$REPO" ls-tree --name-only "$TREE"); do git -C "$REPO" show "$TREE:$f" | cmp -s - "$REPO/supabase/migrations/$f"; done
[ "$(ls "$REPO/supabase/migrations" | wc -l)" = "$(git -C "$REPO" ls-tree --name-only "$TREE" | wc -l)" ]
reset_to() {  # reset_to <version> <expected count>
  ( cd "$REPO" && time "$CLI" db reset --local --version "$1" ) > "$EQ/reset-$1.log" 2>&1
  [ "$(grep -c 'Applying migration' "$EQ/reset-$1.log")" = "$2" ]
  [ "$(ledger)" = "$2 $1" ]
}
{
[ -s "$EQ/fp-mirror-final.json" ] && [ -s "$EQ/dump-mirror-final.norm.sql" ]
echo "fp-mirror-final.json $(sha "$EQ/fp-mirror-final.json") $(wc -c < "$EQ/fp-mirror-final.json") bytes; dump-mirror-final $(wc -l < "$EQ/dump-mirror-final.norm.sql") lines $(sha256sum < "$EQ/dump-mirror-final.norm.sql" | cut -c1-16)"
reset_to 20261023140000 277
fp fresh-fu
echo "(0) plain fresh 20261023140000 vs the follow-up kit's recorded post-state (its batch-2 post summary):"
python3 -I "$KFU/guarded/check-readback.py" "$EQ/fp-fresh-fu.json" 2 post || true
python3 -I "$K324/rehearsal/scripts/fpcompare.py" "$EQ/fp-fresh-fu.json" "$W/logs/mirror/fp-pre-state.json" | grep -v ': equal' | cut -c1-220 || true
t0=$(date +%s.%N)
for v in 20261024110000 20261024220000 20261025200000 20261025400000; do
  f=$(git -C "$REPO" ls-tree --name-only "$TREE" | grep "^${v}_")
  git -C "$REPO" show "$TREE:$f" > "$EQ/$f"
  psql "$DB" -X -q -v ON_ERROR_STOP=1 -1 -f "$EQ/$f" > /dev/null
done
echo "77d04563 tree + the 4 (psql -1 -f each): $(printf '%.3f' "$(echo "$(date +%s.%N)-$t0" | bc)") s"
fp fu-plus-4; dump fu-plus-4
reset_to 20261025400000 281
fp fresh-281; dump fresh-281
bash "$SCRIPTS/drift.sh" "$EQ/drift" > /dev/null
fp fresh-281-drift; dump fresh-281-drift
cmp "$EQ/fp-fu-plus-4.json" "$EQ/fp-fresh-281.json" && echo "(a) undrifted: fingerprint byte-identical"
cmp "$EQ/dump-fu-plus-4.norm.sql" "$EQ/dump-fresh-281.norm.sql" && echo "(a) undrifted: normalised dump identical"
cmp "$EQ/fp-mirror-final.json" "$EQ/fp-fresh-281-drift.json" && echo "(b) drifted: fingerprint byte-identical"
cmp "$EQ/dump-mirror-final.norm.sql" "$EQ/dump-fresh-281-drift.norm.sql" && echo "(b) drifted: normalised dump identical"
} 2>&1 | tee "$EQ/equivalence.txt"
